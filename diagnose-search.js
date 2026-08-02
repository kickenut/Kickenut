const fs = require("fs");
const os = require("os");
const path = require("path");
const { createApp } = require("./server");
const {
  clearDiscoveredDomainCache,
  getCompanySeed,
  getVerifiedResult,
  searchCancellationRoute
} = require("./searchEngine");

const RUNS_PER_QUERY = Number(process.env.KICKENUT_PROBE_RUNS || 3);
const PROBE_TIMEOUT_MS = Number(process.env.KICKENUT_PROBE_REQUEST_TIMEOUT_MS || 30000);
const QUIET_OUTPUT = process.env.KICKENUT_PROBE_QUIET === "1";
const originalConsoleLog = console.log.bind(console);
const OUTPUT_FILE = process.env.KICKENUT_PROBE_OUTPUT || path.join(
  os.tmpdir(),
  `kickenut-search-probe-${Date.now()}.json`
);

if (QUIET_OUTPUT) {
  console.log = () => {};
}

const fixedQueries = [
  { bucket: "saved-control", query: "Netflix" },
  { bucket: "known-safe-fallback", query: "Dropbox" },
  { bucket: "current-failure", query: "Bunnings" },
  { bucket: "current-failure", query: "Paramount+" },
  { bucket: "current-failure", query: "Squarespace" },
  { bucket: "current-failure", query: "LinkedIn Premium" },
  { bucket: "invalid", query: "egjhgjhv" },
  { bucket: "invalid", query: "random fake company 123" }
];

const freshCandidates = [
  "Notion",
  "Patreon",
  "Duolingo",
  "Coursera",
  "Grammarly",
  "Calendly",
  "Skillshare",
  "Crunchyroll"
];

function pickFreshCompanies() {
  const fresh = freshCandidates
    .filter((query) => !getVerifiedResult(query) && !getCompanySeed(query))
    .slice(0, 5)
    .map((query) => ({ bucket: "fresh-unsaved", query }));

  if (fresh.length < 5) {
    throw new Error("Probe needs at least five fresh unsaved companies.");
  }

  return fresh;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServer() {
  const discoveryCacheFile = path.join(os.tmpdir(), `kickenut-discovered-domains-${process.pid}.json`);
  fs.writeFileSync(discoveryCacheFile, "{}", "utf8");

  const app = createApp({
    env: {
      ...process.env,
      NODE_ENV: "test",
      KICKENUT_SEARCH_DIAGNOSTICS: "1",
      KICKENUT_SEARCH_DIAGNOSTICS_RESPONSE: "1",
      KICKENUT_IP_RATE_LIMIT_MAX: process.env.KICKENUT_IP_RATE_LIMIT_MAX || "1000",
      KICKENUT_QUERY_RATE_LIMIT_MAX: process.env.KICKENUT_QUERY_RATE_LIMIT_MAX || "1000"
    },
    searchRunner: (query, options) => searchCancellationRoute(query, {
      ...options,
      discoveryCacheFile
    })
  });

  const httpServer = await new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });

  return {
    app,
    discoveryCacheFile,
    httpServer,
    baseUrl: `http://127.0.0.1:${httpServer.address().port}`
  };
}

async function stopServer(app, httpServer) {
  await app.locals.searchRuntime.shutdown({ graceMs: 1000 });
  await new Promise((resolve, reject) => {
    httpServer.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function requestSearch(baseUrl, query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&diagnostics=1`;
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "x-request-id": `probe-${Date.now()}-${Math.random().toString(16).slice(2)}`
      }
    });
    const text = await response.text();
    let body;

    try {
      body = JSON.parse(text);
    } catch {
      body = { rawBody: text };
    }

    return {
      requestedUrl: url,
      status: response.status,
      durationMs: Date.now() - startedAt,
      body
    };
  } catch (err) {
    return {
      requestedUrl: url,
      status: 0,
      durationMs: Date.now() - startedAt,
      body: {
        error: err.message,
        name: err.name
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runProbe() {
  const targetQueries = [...fixedQueries, ...pickFreshCompanies()];
  const { app, baseUrl, discoveryCacheFile, httpServer } = await startServer();
  const report = {
    startedAt: new Date().toISOString(),
    baseUrl,
    runsPerQuery: RUNS_PER_QUERY,
    targetQueries,
    results: []
  };

  try {
    for (const target of targetQueries) {
      const repetitions = target.bucket === "invalid" ? 1 : RUNS_PER_QUERY;

      for (let run = 1; run <= repetitions; run += 1) {
        app.locals.searchRuntime.clearCaches();
        clearDiscoveredDomainCache(discoveryCacheFile);

        const result = await requestSearch(baseUrl, target.query);
        report.results.push({
          ...target,
          run,
          ...result
        });

        await sleep(100);
      }
    }
  } finally {
    await stopServer(app, httpServer);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));

  const summary = report.results.map((result) => ({
    bucket: result.bucket,
    query: result.query,
    run: result.run,
    status: result.status,
    durationMs: result.durationMs,
    link: result.body?.link || "",
    officialSite: result.body?.officialSite || "",
    error: result.body?.error || ""
  }));

  originalConsoleLog(JSON.stringify({
    outputFile: OUTPUT_FILE,
    summary
  }, null, 2));
}

runProbe().catch((err) => {
  console.error(err);
  process.exit(1);
});
