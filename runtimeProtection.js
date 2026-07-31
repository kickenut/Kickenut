const { getVerifiedResult, normaliseKey, searchCancellationRoute } = require("./searchEngine");

const DEFAULT_POSITIVE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CACHE_MAX_ENTRIES = 500;
const DEFAULT_MAX_CONCURRENT_SEARCHES = 4;
const DEFAULT_MAX_QUEUE_SIZE = 24;
const DEFAULT_QUEUE_TIMEOUT_MS = 3000;
const DEFAULT_IP_RATE_LIMIT_MAX = 60;
const DEFAULT_QUERY_RATE_LIMIT_MAX = 20;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const DEFAULT_SEARCH_TIMEOUT_MS = 10000;
const DEFAULT_DEEP_SEARCH_TIMEOUT_MS = 12000;
const DEFAULT_RATE_LIMIT_MAX_KEYS = 1000;

class RateLimitError extends Error {
  constructor(scope, retryAfterMs) {
    super(`Rate limit exceeded for ${scope}.`);
    this.name = "RateLimitError";
    this.code = "RATE_LIMITED";
    this.statusCode = 429;
    this.scope = scope;
    this.retryAfterMs = retryAfterMs;
  }
}

class OverloadError extends Error {
  constructor(message = "Search queue is full.") {
    super(message);
    this.name = "OverloadError";
    this.code = "OVERLOADED";
    this.statusCode = 503;
  }
}

class SearchTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Search timed out after ${timeoutMs}ms.`);
    this.name = "SearchTimeoutError";
    this.code = "SEARCH_TIMEOUT";
    this.statusCode = 504;
    this.timeoutMs = timeoutMs;
  }
}

class ShutdownError extends Error {
  constructor() {
    super("Search service is shutting down.");
    this.name = "ShutdownError";
    this.code = "SHUTTING_DOWN";
    this.statusCode = 503;
  }
}

class RequestCancelledError extends Error {
  constructor() {
    super("Search request was cancelled.");
    this.name = "RequestCancelledError";
    this.code = "REQUEST_CANCELLED";
    this.statusCode = 499;
  }
}

function readPositiveInteger(value, fallback, minimum = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.floor(number));
}

function cloneResult(result) {
  return JSON.parse(JSON.stringify(result));
}

function nowMs() {
  return Date.now();
}

class SearchResultCache {
  constructor(options = {}) {
    this.maxEntries = readPositiveInteger(options.maxEntries, DEFAULT_CACHE_MAX_ENTRIES);
    this.positiveTtlMs = readPositiveInteger(options.positiveTtlMs, DEFAULT_POSITIVE_CACHE_TTL_MS);
    this.negativeTtlMs = readPositiveInteger(options.negativeTtlMs, DEFAULT_NEGATIVE_CACHE_TTL_MS);
    this.clock = options.clock || nowMs;
    this.entries = new Map();
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;

    if (entry.expiresAt <= this.clock()) {
      this.entries.delete(key);
      return null;
    }

    entry.lastAccessedAt = this.clock();
    this.entries.delete(key);
    this.entries.set(key, entry);

    return {
      negative: entry.negative,
      result: cloneResult(entry.result)
    };
  }

  set(key, result) {
    const negative = !result || !result.link;
    const ttlMs = negative ? this.negativeTtlMs : this.positiveTtlMs;
    if (ttlMs <= 0) return;

    this.entries.set(key, {
      result: cloneResult(result),
      negative,
      savedAt: this.clock(),
      lastAccessedAt: this.clock(),
      expiresAt: this.clock() + ttlMs
    });

    this.prune();
  }

  prune() {
    const now = this.clock();

    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      this.entries.delete(oldestKey);
    }
  }

  stats() {
    this.prune();

    let positiveEntries = 0;
    let negativeEntries = 0;

    for (const entry of this.entries.values()) {
      if (entry.negative) negativeEntries += 1;
      else positiveEntries += 1;
    }

    return {
      entries: this.entries.size,
      positiveEntries,
      negativeEntries,
      maxEntries: this.maxEntries,
      positiveTtlMs: this.positiveTtlMs,
      negativeTtlMs: this.negativeTtlMs
    };
  }
}

class SlidingWindowRateLimiter {
  constructor(options = {}) {
    this.max = readPositiveInteger(options.max, 0, 0);
    this.windowMs = readPositiveInteger(options.windowMs, DEFAULT_RATE_LIMIT_WINDOW_MS);
    this.maxKeys = readPositiveInteger(options.maxKeys, DEFAULT_RATE_LIMIT_MAX_KEYS);
    this.clock = options.clock || nowMs;
    this.entries = new Map();
  }

  check(key) {
    if (!this.max) {
      return { allowed: true, remaining: Infinity, retryAfterMs: 0 };
    }

    this.prune();

    const now = this.clock();
    const safeKey = String(key || "unknown");
    let entry = this.entries.get(safeKey);

    if (!entry || entry.resetAt <= now) {
      entry = {
        count: 0,
        resetAt: now + this.windowMs,
        lastSeenAt: now
      };
      this.entries.set(safeKey, entry);
    }

    entry.lastSeenAt = now;

    if (entry.count >= this.max) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(1, entry.resetAt - now)
      };
    }

    entry.count += 1;
    this.trim();

    return {
      allowed: true,
      remaining: Math.max(0, this.max - entry.count),
      retryAfterMs: Math.max(0, entry.resetAt - now)
    };
  }

  prune() {
    const now = this.clock();

    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) {
        this.entries.delete(key);
      }
    }

    this.trim();
  }

  trim() {
    if (this.entries.size <= this.maxKeys) return;

    const sorted = [...this.entries.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
    for (const [key] of sorted.slice(0, this.entries.size - this.maxKeys)) {
      this.entries.delete(key);
    }
  }

  stats() {
    this.prune();

    return {
      keys: this.entries.size,
      max: this.max,
      windowMs: this.windowMs,
      maxKeys: this.maxKeys
    };
  }
}

function createMetrics() {
  return {
    startedAt: new Date().toISOString(),
    searches: {
      total: 0,
      completed: 0,
      failed: 0,
      timedOut: 0,
      cancelled: 0,
      coalesced: 0,
      cacheHits: {
        total: 0,
        positive: 0,
        negative: 0,
        verified: 0
      },
      cacheMisses: 0,
      rateLimited: 0,
      overloaded: 0
    },
    latencyMs: {
      count: 0,
      total: 0,
      min: null,
      max: 0,
      buckets: {
        le100: 0,
        le500: 0,
        le1000: 0,
        le3000: 0,
        le8000: 0,
        gt8000: 0
      }
    },
    queue: {
      active: 0,
      queued: 0,
      maxActive: 0,
      maxQueued: 0,
      rejected: 0
    },
    shutdown: false
  };
}

function recordLatency(metrics, latencyMs) {
  metrics.latencyMs.count += 1;
  metrics.latencyMs.total += latencyMs;
  metrics.latencyMs.min = metrics.latencyMs.min === null ? latencyMs : Math.min(metrics.latencyMs.min, latencyMs);
  metrics.latencyMs.max = Math.max(metrics.latencyMs.max, latencyMs);

  if (latencyMs <= 100) metrics.latencyMs.buckets.le100 += 1;
  else if (latencyMs <= 500) metrics.latencyMs.buckets.le500 += 1;
  else if (latencyMs <= 1000) metrics.latencyMs.buckets.le1000 += 1;
  else if (latencyMs <= 3000) metrics.latencyMs.buckets.le3000 += 1;
  else if (latencyMs <= 8000) metrics.latencyMs.buckets.le8000 += 1;
  else metrics.latencyMs.buckets.gt8000 += 1;
}

function makeSearchKey(query, options = {}) {
  return `${options.deep ? "deep" : "normal"}:${normaliseKey(query)}`;
}

function createSearchRuntime(options = {}) {
  const config = {
    maxConcurrent: readPositiveInteger(options.maxConcurrent, DEFAULT_MAX_CONCURRENT_SEARCHES),
    maxQueueSize: readPositiveInteger(options.maxQueueSize, DEFAULT_MAX_QUEUE_SIZE, 0),
    queueTimeoutMs: readPositiveInteger(options.queueTimeoutMs, DEFAULT_QUEUE_TIMEOUT_MS),
    searchTimeoutMs: readPositiveInteger(options.searchTimeoutMs, DEFAULT_SEARCH_TIMEOUT_MS),
    deepSearchTimeoutMs: readPositiveInteger(options.deepSearchTimeoutMs, DEFAULT_DEEP_SEARCH_TIMEOUT_MS),
    maxCacheEntries: readPositiveInteger(options.maxCacheEntries, DEFAULT_CACHE_MAX_ENTRIES),
    positiveCacheTtlMs: readPositiveInteger(options.positiveCacheTtlMs, DEFAULT_POSITIVE_CACHE_TTL_MS),
    negativeCacheTtlMs: readPositiveInteger(options.negativeCacheTtlMs, DEFAULT_NEGATIVE_CACHE_TTL_MS),
    ipRateLimitMax: readPositiveInteger(options.ipRateLimitMax, DEFAULT_IP_RATE_LIMIT_MAX, 0),
    queryRateLimitMax: readPositiveInteger(options.queryRateLimitMax, DEFAULT_QUERY_RATE_LIMIT_MAX, 0),
    ipRateLimitWindowMs: readPositiveInteger(options.ipRateLimitWindowMs, DEFAULT_RATE_LIMIT_WINDOW_MS),
    queryRateLimitWindowMs: readPositiveInteger(options.queryRateLimitWindowMs, DEFAULT_RATE_LIMIT_WINDOW_MS),
    rateLimitMaxKeys: readPositiveInteger(options.rateLimitMaxKeys, DEFAULT_RATE_LIMIT_MAX_KEYS)
  };

  const searchRunner = options.searchRunner || searchCancellationRoute;
  const cache = new SearchResultCache({
    maxEntries: config.maxCacheEntries,
    positiveTtlMs: config.positiveCacheTtlMs,
    negativeTtlMs: config.negativeCacheTtlMs,
    clock: options.clock
  });
  const ipLimiter = new SlidingWindowRateLimiter({
    max: config.ipRateLimitMax,
    windowMs: config.ipRateLimitWindowMs,
    maxKeys: config.rateLimitMaxKeys,
    clock: options.clock
  });
  const queryLimiter = new SlidingWindowRateLimiter({
    max: config.queryRateLimitMax,
    windowMs: config.queryRateLimitWindowMs,
    maxKeys: config.rateLimitMaxKeys,
    clock: options.clock
  });
  const metrics = createMetrics();
  const inflight = new Map();
  const queue = [];
  const controllers = new Set();
  let activeCount = 0;
  let accepting = true;

  function updateQueueMetrics() {
    metrics.queue.active = activeCount;
    metrics.queue.queued = queue.length;
    metrics.queue.maxActive = Math.max(metrics.queue.maxActive, activeCount);
    metrics.queue.maxQueued = Math.max(metrics.queue.maxQueued, queue.length);
  }

  function runQueued() {
    while (activeCount < config.maxConcurrent && queue.length) {
      const item = queue.shift();

      clearTimeout(item.timeoutId);

      if (item.controller.signal.aborted) {
        item.reject(new RequestCancelledError());
        continue;
      }

      activeCount += 1;
      updateQueueMetrics();

      Promise.resolve()
        .then(item.task)
        .then(item.resolve, item.reject)
        .finally(() => {
          activeCount -= 1;
          updateQueueMetrics();
          runQueued();
        });
    }

    updateQueueMetrics();
  }

  function schedule(task, controller) {
    if (!accepting) {
      return Promise.reject(new ShutdownError());
    }

    if (activeCount < config.maxConcurrent) {
      activeCount += 1;
      updateQueueMetrics();

      return Promise.resolve()
        .then(task)
        .finally(() => {
          activeCount -= 1;
          updateQueueMetrics();
          runQueued();
        });
    }

    if (queue.length >= config.maxQueueSize) {
      metrics.queue.rejected += 1;
      metrics.searches.overloaded += 1;
      throw new OverloadError();
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const item = {
        controller,
        task,
        resolve(value) {
          if (settled) return;
          settled = true;
          clearTimeout(item.timeoutId);
          resolve(value);
        },
        reject(err) {
          if (settled) return;
          settled = true;
          clearTimeout(item.timeoutId);
          reject(err);
        },
        timeoutId: null
      };

      item.timeoutId = setTimeout(() => {
        const index = queue.indexOf(item);
        if (index !== -1) {
          queue.splice(index, 1);
          updateQueueMetrics();
          metrics.queue.rejected += 1;
          metrics.searches.overloaded += 1;
          item.reject(new OverloadError("Search queue wait timed out."));
        }
      }, config.queueTimeoutMs);

      const removeQueuedItem = () => {
        const index = queue.indexOf(item);
        if (index !== -1) {
          queue.splice(index, 1);
          updateQueueMetrics();
          item.reject(new RequestCancelledError());
        }
      };

      queue.push(item);
      updateQueueMetrics();

      controller.signal.addEventListener("abort", removeQueuedItem, { once: true });
    });
  }

  async function executeSearch(query, runtimeOptions, controller) {
    const timeoutMs = runtimeOptions.deep ? config.deepSearchTimeoutMs : config.searchTimeoutMs;
    let timeoutId = null;

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new SearchTimeoutError(timeoutMs));
      }, timeoutMs);
    });

    try {
      return await Promise.race([
        Promise.resolve(searchRunner(query, {
          ...runtimeOptions,
          signal: controller.signal,
          deadlineMs: Date.now() + timeoutMs
        })),
        timeoutPromise
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function waitForInflight(entry, signal) {
    if (!signal) return entry.promise.then(cloneResult);

    if (signal.aborted) {
      return Promise.reject(new RequestCancelledError());
    }

    entry.waiters += 1;
    let released = false;

    function release() {
      if (released) return;
      released = true;
      entry.waiters = Math.max(0, entry.waiters - 1);

      if (entry.waiters === 0 && !entry.settled) {
        entry.controller.abort();
      }
    }

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        metrics.searches.cancelled += 1;
        release();
        reject(new RequestCancelledError());
      };

      signal.addEventListener("abort", onAbort, { once: true });

      entry.promise
        .then((result) => resolve(cloneResult(result)))
        .catch(reject)
        .finally(() => {
          signal.removeEventListener("abort", onAbort);
          release();
        });
    });
  }

  async function search(query, runtimeOptions = {}) {
    const startedAt = Date.now();
    const key = makeSearchKey(query, runtimeOptions);
    const queryKey = normaliseKey(query);

    metrics.searches.total += 1;

    if (!accepting) {
      throw new ShutdownError();
    }

    const verified = getVerifiedResult(query);
    if (verified) {
      cache.set(key, verified);
      metrics.searches.cacheHits.verified += 1;
      metrics.searches.completed += 1;
      recordLatency(metrics, Date.now() - startedAt);
      return cloneResult(verified);
    }

    const ipLimit = ipLimiter.check(runtimeOptions.ip || "unknown");
    if (!ipLimit.allowed) {
      metrics.searches.rateLimited += 1;
      throw new RateLimitError("ip", ipLimit.retryAfterMs);
    }

    const queryLimit = queryLimiter.check(queryKey || "empty");
    if (!queryLimit.allowed) {
      metrics.searches.rateLimited += 1;
      throw new RateLimitError("query", queryLimit.retryAfterMs);
    }

    const cached = cache.get(key);
    if (cached) {
      metrics.searches.cacheHits.total += 1;
      if (cached.negative) metrics.searches.cacheHits.negative += 1;
      else metrics.searches.cacheHits.positive += 1;
      metrics.searches.completed += 1;
      recordLatency(metrics, Date.now() - startedAt);
      return cached.result;
    }

    metrics.searches.cacheMisses += 1;

    const existing = inflight.get(key);
    if (existing) {
      metrics.searches.coalesced += 1;
      const result = await waitForInflight(existing, runtimeOptions.signal);
      metrics.searches.completed += 1;
      recordLatency(metrics, Date.now() - startedAt);
      return result;
    }

    const controller = new AbortController();
    controllers.add(controller);

    const entry = {
      key,
      controller,
      waiters: 0,
      settled: false,
      promise: null
    };

    let scheduledSearch;

    try {
      scheduledSearch = schedule(() => executeSearch(query, runtimeOptions, controller), controller);
    } catch (err) {
      controllers.delete(controller);
      throw err;
    }

    entry.promise = scheduledSearch
      .then((result) => {
        const safeResult = result || {
          error: "No official cancellation route found yet.",
          searched: true
        };

        cache.set(key, safeResult);
        return safeResult;
      })
      .catch((err) => {
        if (err instanceof SearchTimeoutError) metrics.searches.timedOut += 1;
        else if (err instanceof RequestCancelledError) metrics.searches.cancelled += 1;
        else metrics.searches.failed += 1;

        throw err;
      })
      .finally(() => {
        entry.settled = true;
        controllers.delete(controller);
        inflight.delete(key);
      });

    inflight.set(key, entry);

    try {
      const result = await waitForInflight(entry, runtimeOptions.signal);
      metrics.searches.completed += 1;
      recordLatency(metrics, Date.now() - startedAt);
      return result;
    } catch (err) {
      recordLatency(metrics, Date.now() - startedAt);
      throw err;
    }
  }

  async function shutdown(options = {}) {
    accepting = false;
    metrics.shutdown = true;

    while (queue.length) {
      const item = queue.shift();
      item.controller.abort();
      item.reject(new ShutdownError());
    }

    updateQueueMetrics();

    const graceMs = readPositiveInteger(options.graceMs, 5000, 0);
    const deadline = Date.now() + graceMs;

    while (inflight.size && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    for (const controller of controllers) {
      controller.abort();
    }
  }

  function isReady() {
    return accepting && queue.length < config.maxQueueSize;
  }

  function getMetrics() {
    cache.prune();
    ipLimiter.prune();
    queryLimiter.prune();
    updateQueueMetrics();

    return {
      ...metrics,
      uptimeSeconds: Math.round((Date.now() - Date.parse(metrics.startedAt)) / 1000),
      latencyMs: {
        ...metrics.latencyMs,
        average: metrics.latencyMs.count
          ? Math.round(metrics.latencyMs.total / metrics.latencyMs.count)
          : 0
      },
      cache: cache.stats(),
      rateLimits: {
        ip: ipLimiter.stats(),
        query: queryLimiter.stats()
      },
      config: {
        maxConcurrent: config.maxConcurrent,
        maxQueueSize: config.maxQueueSize,
        queueTimeoutMs: config.queueTimeoutMs,
        searchTimeoutMs: config.searchTimeoutMs,
        deepSearchTimeoutMs: config.deepSearchTimeoutMs
      }
    };
  }

  function getState() {
    return {
      accepting,
      inflight: inflight.size,
      active: activeCount,
      queued: queue.length,
      cache: cache.stats()
    };
  }

  return {
    config,
    getMetrics,
    getState,
    isReady,
    search,
    shutdown
  };
}

function runtimeOptionsFromEnv(env = process.env) {
  return {
    maxConcurrent: readPositiveInteger(env.KICKENUT_MAX_CONCURRENT_SEARCHES, DEFAULT_MAX_CONCURRENT_SEARCHES),
    maxQueueSize: readPositiveInteger(env.KICKENUT_MAX_QUEUE_SIZE, DEFAULT_MAX_QUEUE_SIZE, 0),
    queueTimeoutMs: readPositiveInteger(env.KICKENUT_QUEUE_TIMEOUT_MS, DEFAULT_QUEUE_TIMEOUT_MS),
    maxCacheEntries: readPositiveInteger(env.KICKENUT_CACHE_MAX_ENTRIES, DEFAULT_CACHE_MAX_ENTRIES),
    positiveCacheTtlMs: readPositiveInteger(env.KICKENUT_CACHE_POSITIVE_TTL_MS, DEFAULT_POSITIVE_CACHE_TTL_MS),
    negativeCacheTtlMs: readPositiveInteger(env.KICKENUT_CACHE_NEGATIVE_TTL_MS, DEFAULT_NEGATIVE_CACHE_TTL_MS),
    ipRateLimitMax: readPositiveInteger(env.KICKENUT_IP_RATE_LIMIT_MAX, DEFAULT_IP_RATE_LIMIT_MAX, 0),
    queryRateLimitMax: readPositiveInteger(env.KICKENUT_QUERY_RATE_LIMIT_MAX, DEFAULT_QUERY_RATE_LIMIT_MAX, 0),
    ipRateLimitWindowMs: readPositiveInteger(env.KICKENUT_IP_RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_LIMIT_WINDOW_MS),
    queryRateLimitWindowMs: readPositiveInteger(env.KICKENUT_QUERY_RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_LIMIT_WINDOW_MS),
    rateLimitMaxKeys: readPositiveInteger(env.KICKENUT_RATE_LIMIT_MAX_KEYS, DEFAULT_RATE_LIMIT_MAX_KEYS),
    searchTimeoutMs: readPositiveInteger(env.KICKENUT_SEARCH_TIMEOUT_MS, DEFAULT_SEARCH_TIMEOUT_MS),
    deepSearchTimeoutMs: readPositiveInteger(env.KICKENUT_DEEP_SEARCH_TIMEOUT_MS, DEFAULT_DEEP_SEARCH_TIMEOUT_MS)
  };
}

module.exports = {
  DEFAULT_CACHE_MAX_ENTRIES,
  DEFAULT_DEEP_SEARCH_TIMEOUT_MS,
  DEFAULT_IP_RATE_LIMIT_MAX,
  DEFAULT_MAX_CONCURRENT_SEARCHES,
  DEFAULT_MAX_QUEUE_SIZE,
  DEFAULT_NEGATIVE_CACHE_TTL_MS,
  DEFAULT_POSITIVE_CACHE_TTL_MS,
  DEFAULT_QUEUE_TIMEOUT_MS,
  DEFAULT_QUERY_RATE_LIMIT_MAX,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  DEFAULT_SEARCH_TIMEOUT_MS,
  OverloadError,
  RateLimitError,
  RequestCancelledError,
  SearchResultCache,
  SearchTimeoutError,
  ShutdownError,
  SlidingWindowRateLimiter,
  createSearchRuntime,
  makeSearchKey,
  runtimeOptionsFromEnv
};
