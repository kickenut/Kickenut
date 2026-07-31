const assert = require("assert");
const { createSearchRuntime } = require("./runtimeProtection");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeResult(query) {
  const company = String(query || "Company");

  if (company.includes("Miss")) {
    return {
      company,
      error: "No official cancellation route found yet.",
      searched: true
    };
  }

  return {
    company,
    title: `${company} official cancellation route`,
    link: `https://${company.toLowerCase().replace(/[^a-z0-9]/g, "")}.example/cancel`,
    source: "live-official-site-discovery",
    confidence: "High",
    verified: false,
    resultType: "Official cancellation route",
    tier: "Tier 1 candidate",
    instruction: "Open the official result and follow the cancellation steps on that page."
  };
}

(async () => {
  let runnerCalls = 0;
  const runtime = createSearchRuntime({
    searchRunner: async (query) => {
      runnerCalls += 1;
      await wait(8);
      return makeResult(query);
    },
    maxConcurrent: 8,
    maxQueueSize: 200,
    maxCacheEntries: 100,
    ipRateLimitMax: 1000,
    queryRateLimitMax: 1000,
    positiveCacheTtlMs: 60000,
    negativeCacheTtlMs: 60000,
    searchTimeoutMs: 1000
  });
  const queries = [
    "Load Alpha",
    "Load Beta",
    "Load Gamma",
    "Load Miss",
    "Load Alpha",
    "Load Beta"
  ];
  const totalRequests = 180;
  const startedAt = Date.now();

  const results = await Promise.all(Array.from({ length: totalRequests }, (_, index) => (
    runtime.search(queries[index % queries.length], {
      ip: `198.51.100.${index % 30}`
    })
  )));
  const durationMs = Date.now() - startedAt;
  const metrics = runtime.getMetrics();

  assert.strictEqual(results.length, totalRequests);
  assert(metrics.searches.completed >= totalRequests);
  assert(metrics.searches.coalesced > 0 || metrics.searches.cacheHits.total > 0);
  assert.strictEqual(metrics.searches.overloaded, 0);
  assert(metrics.latencyMs.average < 200, "Deterministic load-test average latency should stay low.");

  console.log(JSON.stringify({
    totalRequests,
    runnerCalls,
    durationMs,
    completed: metrics.searches.completed,
    cacheHits: metrics.searches.cacheHits,
    coalesced: metrics.searches.coalesced,
    overloaded: metrics.searches.overloaded,
    averageLatencyMs: metrics.latencyMs.average,
    maxLatencyMs: metrics.latencyMs.max,
    maxActive: metrics.queue.maxActive,
    maxQueued: metrics.queue.maxQueued
  }, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
