const assert = require("assert");
const EventEmitter = require("events");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  OverloadError,
  RateLimitError,
  SearchTimeoutError,
  ShutdownError,
  createSearchRuntime
} = require("./runtimeProtection");
const { readJsonFile, writeJsonFileAtomic } = require("./jsonStorage");
const { pruneReviewCandidates } = require("./reviewQueue");
const {
  createApp,
  handleSearch,
  readinessState,
  securityHeaders
} = require("./server");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeResult(company, overrides = {}) {
  return {
    company,
    title: `${company} official cancellation route`,
    link: `https://${company.toLowerCase().replace(/[^a-z0-9]/g, "")}.example/cancel`,
    source: "verified",
    confidence: "High",
    verified: true,
    resultType: "Official cancellation route",
    tier: "Tier 1",
    instruction: "Open the official result and follow the cancellation steps on that page.",
    ...overrides
  };
}

function mockRequest(app, query, ip = "127.0.0.1") {
  const req = new EventEmitter();
  req.app = app;
  req.headers = {};
  req.ip = ip;
  req.method = "GET";
  req.path = "/search";
  req.query = { q: query };
  req.socket = { remoteAddress: ip };
  return req;
}

function mockResponse() {
  const res = new EventEmitter();
  res.body = null;
  res.headers = {};
  res.statusCode = 200;
  res.writableEnded = false;
  res.setHeader = (name, value) => {
    res.headers[name.toLowerCase()] = String(value);
  };
  res.getHeader = (name) => res.headers[name.toLowerCase()];
  res.status = (statusCode) => {
    res.statusCode = statusCode;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    res.writableEnded = true;
    res.emit("finish");
    return res;
  };
  return res;
}

(async () => {
  {
    let calls = 0;
    const runtime = createSearchRuntime({
      searchRunner: async (query) => {
        calls += 1;
        if (query === "Cache Miss") {
          return {
            company: query,
            error: "No official cancellation route found yet.",
            searched: true
          };
        }

        return makeResult(query, { verified: false, source: "live-official-site-discovery" });
      },
      ipRateLimitMax: 100,
      queryRateLimitMax: 100
    });

    await runtime.search("Cache Hit", { ip: "cache-positive-1" });
    await runtime.search("Cache Hit", { ip: "cache-positive-2" });
    await runtime.search("Cache Miss", { ip: "cache-negative-1" });
    await runtime.search("Cache Miss", { ip: "cache-negative-2" });

    assert.strictEqual(calls, 2, "Positive and negative cache hits must avoid duplicate runner calls.");

    const metrics = runtime.getMetrics();
    assert.strictEqual(metrics.searches.cacheHits.positive, 1);
    assert.strictEqual(metrics.searches.cacheHits.negative, 1);
  }

  {
    let calls = 0;
    const runtime = createSearchRuntime({
      searchRunner: async (query) => {
        calls += 1;
        return makeResult(query, { verified: false, source: "live-official-site-discovery" });
      },
      maxCacheEntries: 2,
      positiveCacheTtlMs: 20,
      ipRateLimitMax: 100,
      queryRateLimitMax: 100
    });

    await runtime.search("Cache Alpha", { ip: "ttl-1" });
    await runtime.search("Cache Beta", { ip: "ttl-2" });
    await runtime.search("Cache Gamma", { ip: "ttl-3" });
    assert(runtime.getMetrics().cache.entries <= 2, "Search cache must stay bounded.");

    await wait(30);
    await runtime.search("Cache Gamma", { ip: "ttl-4" });
    assert.strictEqual(calls, 4, "Expired cache entries must be refreshed.");
  }

  {
    let calls = 0;
    const runtime = createSearchRuntime({
      searchRunner: async (query) => {
        calls += 1;
        await wait(25);
        return makeResult(query, { verified: false, source: "live-official-site-discovery" });
      },
      ipRateLimitMax: 100,
      queryRateLimitMax: 100
    });

    const [first, second] = await Promise.all([
      runtime.search("Coalesce Me", { ip: "coalesce-1" }),
      runtime.search("Coalesce Me", { ip: "coalesce-2" })
    ]);

    assert.strictEqual(calls, 1, "Identical in-flight searches must coalesce.");
    assert.strictEqual(first.link, second.link);
    assert.strictEqual(runtime.getMetrics().searches.coalesced, 1);
  }

  {
    let release;
    const blocker = new Promise((resolve) => {
      release = resolve;
    });
    const runtime = createSearchRuntime({
      searchRunner: async (query) => {
        await blocker;
        return makeResult(query, { verified: false, source: "live-official-site-discovery" });
      },
      maxConcurrent: 1,
      maxQueueSize: 1,
      ipRateLimitMax: 100,
      queryRateLimitMax: 100
    });

    const first = runtime.search("Queue One", { ip: "queue-1" });
    await wait(5);
    const second = runtime.search("Queue Two", { ip: "queue-2" });
    await assert.rejects(
      runtime.search("Queue Three", { ip: "queue-3" }),
      OverloadError,
      "Full queues must reject gracefully."
    );
    release();
    await Promise.all([first, second]);

    const metrics = runtime.getMetrics();
    assert.strictEqual(metrics.searches.overloaded, 1);
    assert(metrics.queue.maxQueued >= 1);
  }

  {
    const runtime = createSearchRuntime({
      searchRunner: async (query) => makeResult(query, { verified: false, source: "live-official-site-discovery" }),
      ipRateLimitMax: 1,
      queryRateLimitMax: 100
    });

    await runtime.search("Rate One", { ip: "rate-ip" });
    await assert.rejects(runtime.search("Rate Two", { ip: "rate-ip" }), RateLimitError);
  }

  {
    const runtime = createSearchRuntime({
      searchRunner: async () => {
        throw new Error("Verified results should not use live discovery.");
      },
      ipRateLimitMax: 1,
      queryRateLimitMax: 1
    });

    await runtime.search("Netflix", { ip: "verified-bypass" });
    await runtime.search("Netflix", { ip: "verified-bypass" });

    assert.strictEqual(runtime.getMetrics().searches.rateLimited, 0, "Verified saved results must not be blocked by live-discovery rate limits.");
    assert.strictEqual(runtime.getMetrics().searches.cacheHits.verified, 2);
  }

  {
    const runtime = createSearchRuntime({
      searchRunner: async (query) => makeResult(query, { verified: false, source: "live-official-site-discovery" }),
      ipRateLimitMax: 100,
      queryRateLimitMax: 1
    });

    await runtime.search("Repeated Query", { ip: "query-rate-1" });
    await assert.rejects(runtime.search("Repeated Query", { ip: "query-rate-2" }), RateLimitError);
  }

  {
    const runtime = createSearchRuntime({
      searchRunner: async (query) => {
        await wait(80);
        return makeResult(query, { verified: false, source: "live-official-site-discovery" });
      },
      maxConcurrent: 1,
      maxQueueSize: 1,
      queueTimeoutMs: 10,
      ipRateLimitMax: 100,
      queryRateLimitMax: 100
    });

    const active = runtime.search("Queue Timeout Active", { ip: "queue-timeout-1" });
    await wait(5);
    await assert.rejects(
      runtime.search("Queue Timeout Waiting", { ip: "queue-timeout-2" }),
      OverloadError,
      "Queued searches must time out instead of waiting indefinitely."
    );
    await active;
  }

  {
    const runtime = createSearchRuntime({
      searchRunner: async () => {
        await wait(100);
        return makeResult("Slow Search", { verified: false, source: "live-official-site-discovery" });
      },
      searchTimeoutMs: 20,
      ipRateLimitMax: 100,
      queryRateLimitMax: 100
    });

    await assert.rejects(runtime.search("Slow Search", { ip: "timeout-1" }), SearchTimeoutError);
    assert.strictEqual(runtime.getMetrics().searches.timedOut, 1);
  }

  {
    const runtime = createSearchRuntime({
      searchRunner: async (query) => makeResult(query, { verified: false, source: "live-official-site-discovery" }),
      ipRateLimitMax: 100,
      queryRateLimitMax: 100
    });

    await runtime.shutdown({ graceMs: 10 });
    await assert.rejects(runtime.search("After Shutdown", { ip: "shutdown-1" }), ShutdownError);
  }

  {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kickenut-json-storage-"));
    const filePath = path.join(tempDir, "state.json");

    writeJsonFileAtomic(filePath, [{ ok: true }]);
    assert.deepStrictEqual(readJsonFile(filePath, [], { validate: Array.isArray }), [{ ok: true }]);

    fs.writeFileSync(filePath, "{broken", "utf8");
    assert.deepStrictEqual(readJsonFile(filePath, [], { validate: Array.isArray }), []);
    assert(
      fs.readdirSync(tempDir).some((file) => file.includes("state.json.corrupt-")),
      "Corrupt JSON files must be quarantined before fallback data is used."
    );
  }

  {
    const pruned = pruneReviewCandidates([
      { canonicalUrl: "https://old.example/cancel", firstFound: "2026-01-01T00:00:00.000Z", lastSeen: "2026-01-01T00:00:00.000Z" },
      { canonicalUrl: "https://new.example/cancel", firstFound: "2026-01-02T00:00:00.000Z", lastSeen: "2026-01-03T00:00:00.000Z" },
      { canonicalUrl: "https://middle.example/cancel", firstFound: "2026-01-02T00:00:00.000Z", lastSeen: "2026-01-02T00:00:00.000Z" }
    ], { maxEntries: 2 });

    assert.deepStrictEqual(
      pruned.map((candidate) => candidate.canonicalUrl),
      ["https://new.example/cancel", "https://middle.example/cancel"],
      "Review queue pruning must keep the newest candidates and bound file growth."
    );
  }

  {
    const app = createApp({
      searchRunner: async (query) => makeResult(query),
      env: {
        NODE_ENV: "test",
        KICKENUT_IP_RATE_LIMIT_MAX: "100",
        KICKENUT_QUERY_RATE_LIMIT_MAX: "100"
      }
    });
    const headerResponse = mockResponse();
    securityHeaders(mockRequest(app, "Header Check"), headerResponse, () => {});
    assert.strictEqual(headerResponse.getHeader("x-content-type-options"), "nosniff");
    assert.strictEqual(headerResponse.getHeader("x-frame-options"), "DENY");
    assert(headerResponse.getHeader("content-security-policy").includes("frame-ancestors 'none'"));

    const ready = readinessState(app.locals.searchRuntime);
    assert.strictEqual(ready.ready, true);

    const metrics = app.locals.searchRuntime.getMetrics();
    assert(metrics.cache);
    assert(metrics.rateLimits);

    const response = mockResponse();
    await handleSearch(mockRequest(app, "Endpoint Check"), response, {
      runtime: app.locals.searchRuntime,
      deep: false
    });
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.link, "https://endpointcheck.example/cancel");
  }

  {
    const serverSource = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");

    assert(!serverSource.includes("express.static(__dirname)"), "The project root must not be exposed as a public static directory.");
    assert(serverSource.includes('app.get("/", sendPage(INDEX_FILE))'), "The homepage must be served through an explicit allowlisted route.");
    assert(serverSource.includes('app.get("/index.html", sendPage(INDEX_FILE))'), "index.html must be served through an explicit allowlisted route.");
    assert(serverSource.includes('app.get("/search.html", sendPage(SEARCH_FILE))'), "search.html must be served through an explicit allowlisted route.");
    assert(serverSource.includes('app.get("/health", sendHealth)'), "The primary health endpoint must be /health.");
    assert(serverSource.includes('app.get("/ready", sendReady)'), "The primary readiness endpoint must be /ready.");
    assert(!serverSource.includes('app.get("/server.js"'), "Server code must not have a public route.");
    assert(!serverSource.includes('app.get("/package.json"'), "Package files must not have public routes.");
    assert(!serverSource.includes('app.get("/data/'), "Data files must not have public routes.");
  }

  {
    const app = createApp({
      searchRunner: async () => {
        throw new Error("SECRET_VALUE_SHOULD_NOT_LEAK");
      },
      env: {
        NODE_ENV: "production",
        KICKENUT_IP_RATE_LIMIT_MAX: "100",
        KICKENUT_QUERY_RATE_LIMIT_MAX: "100"
      }
    });
    const response = mockResponse();
    await handleSearch(mockRequest(app, "Exploding Search"), response, {
      runtime: app.locals.searchRuntime,
      deep: false
    });
    assert.strictEqual(response.statusCode, 500);
    assert.strictEqual(response.body.error, "Server error");
    assert(!JSON.stringify(response.body).includes("SECRET_VALUE_SHOULD_NOT_LEAK"));
  }

  console.log("Kickenut launch protection checks passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
