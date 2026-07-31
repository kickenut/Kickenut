const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { searchCancellationRoute, deriveOfficialSiteUrl } = require("./searchEngine");
const { recordReviewCandidate } = require("./reviewQueue");
const {
  OverloadError,
  RateLimitError,
  RequestCancelledError,
  SearchTimeoutError,
  ShutdownError,
  createSearchRuntime,
  runtimeOptionsFromEnv
} = require("./runtimeProtection");

const PORT = process.env.PORT || 3000;
const MAX_QUERY_LENGTH = 120;
const ROOT_DIR = __dirname;
const INDEX_FILE = path.join(ROOT_DIR, "index.html");
const SEARCH_FILE = path.join(ROOT_DIR, "search.html");
const DATA_FILES = [
  path.join(ROOT_DIR, "data", "discoveredDomains.json"),
  path.join(ROOT_DIR, "data", "reviewCandidates.json"),
  path.join(ROOT_DIR, "data", "verifiedHealth.json")
];

function canonicalResultTarget(value) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = (url.pathname.replace(/\/+$/, "") || "/");
    return url.href;
  } catch {
    return "";
  }
}

function buildOfficialSiteValue(result) {
  const officialSite = result.officialSite || deriveOfficialSiteUrl(result.link, result.company);

  if (!officialSite) return "";
  if (canonicalResultTarget(officialSite) === canonicalResultTarget(result.link)) return "";

  return officialSite;
}

function buildResultResponse(result) {
  if (!result || result.error) return result;

  const officialSite = buildOfficialSiteValue(result);

  return {
    company: result.company,
    title: result.title,
    link: result.link,
    source: result.source,
    confidence: result.confidence,
    verified: result.verified,
    notes: result.notes,
    officialSite,
    resultType: result.resultType || "Official route",
    tier: result.tier || (result.confidence === "High" ? "Tier 1" : "Tier 2"),
    language: result.language || "",
    instruction:
      result.instruction ||
      "Open the official result and follow the cancellation steps on that page."
  };
}

function getSearchQuery(req) {
  return String(req.query.q || req.query.query || "").trim();
}

function getQueryKey(query) {
  return String(query || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function logStructured(level, event, fields = {}) {
  const entry = {
    time: new Date().toISOString(),
    level,
    event,
    ...fields
  };

  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else console.log(line);
}

function parseAllowedOrigins(value = process.env.KICKENUT_ALLOWED_ORIGINS || "") {
  return String(value)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function corsMiddleware() {
  const allowedOrigins = parseAllowedOrigins();

  if (process.env.NODE_ENV !== "production" && !allowedOrigins.length) {
    return cors();
  }

  return cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    }
  });
}

function securityHeaders(req, res, next) {
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'"
  ].join("; "));
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
}

function requestLogger(req, res, next) {
  const startedAt = Date.now();
  req.id = req.headers["x-request-id"] || crypto.randomUUID();
  res.setHeader("X-Request-Id", req.id);

  res.on("finish", () => {
    logStructured("info", "http_request", {
      requestId: req.id,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });

  next();
}

function requestSignal(req, res) {
  const controller = new AbortController();
  const abort = () => controller.abort();

  req.on("aborted", abort);
  res.on("close", () => {
    if (!res.writableEnded) abort();
  });

  return controller.signal;
}

function readinessState(runtime) {
  const checks = [];

  for (const filePath of DATA_FILES) {
    try {
      JSON.parse(fs.readFileSync(filePath, "utf8"));
      checks.push({ name: path.relative(ROOT_DIR, filePath), ok: true });
    } catch (err) {
      checks.push({
        name: path.relative(ROOT_DIR, filePath),
        ok: false,
        reason: err.message
      });
    }
  }

  const state = runtime.getState();
  checks.push({
    name: "search-runtime",
    ok: runtime.isReady(),
    active: state.active,
    queued: state.queued,
    accepting: state.accepting
  });

  const ready = checks.every((check) => check.ok);

  return {
    ready,
    checks
  };
}

function sendPage(filePath) {
  return (req, res, next) => {
    res.sendFile(filePath, (err) => {
      if (err) next(err);
    });
  };
}

function mapSearchError(err) {
  if (err instanceof RateLimitError) {
    return {
      statusCode: 429,
      body: {
        error: "Too many searches. Please wait a moment and try again.",
        searched: false,
        retryAfterSeconds: Math.ceil(err.retryAfterMs / 1000)
      }
    };
  }

  if (err instanceof OverloadError) {
    return {
      statusCode: 503,
      body: {
        error: "Kickenut is busy right now. Please try again shortly.",
        searched: false
      }
    };
  }

  if (err instanceof SearchTimeoutError) {
    return {
      statusCode: 504,
      body: {
        error: "Search timed out while checking official sources. Please try again.",
        searched: true
      }
    };
  }

  if (err instanceof ShutdownError) {
    return {
      statusCode: 503,
      body: {
        error: "Kickenut is restarting. Please try again shortly.",
        searched: false
      }
    };
  }

  if (err instanceof RequestCancelledError) {
    return {
      statusCode: 499,
      body: {
        error: "Search request cancelled.",
        searched: false
      }
    };
  }

  return {
    statusCode: 500,
    body: {
      error: "Server error",
      searched: true
    }
  };
}

async function handleSearch(req, res, options = {}) {
  const runtime = options.runtime || req.app.locals.searchRuntime;
  const query = getSearchQuery(req);
  const queryKey = getQueryKey(query);
  const startedAt = Date.now();

  if (!query) {
    return res.json({
      error: "No query provided",
      searched: false
    });
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return res.status(400).json({
      error: "Search query is too long.",
      searched: false
    });
  }

  try {
    const result = await runtime.search(query, {
      deep: Boolean(options.deep),
      ip: req.ip || req.socket?.remoteAddress || "unknown",
      requestId: req.id,
      signal: requestSignal(req, res)
    });

    if (result.link) {
      const response = buildResultResponse(result);
      recordReviewCandidate(query, result, {
        officialSite: response.officialSite
      });
      logStructured("info", "search_completed", {
        requestId: req.id,
        queryKey,
        source: response.source,
        verified: Boolean(response.verified),
        durationMs: Date.now() - startedAt
      });
      return res.json(response);
    }

    logStructured("info", "search_no_result", {
      requestId: req.id,
      queryKey,
      durationMs: Date.now() - startedAt
    });
    return res.json(buildResultResponse(result));
  } catch (err) {
    const mapped = mapSearchError(err);

    logStructured(mapped.statusCode >= 500 ? "error" : "info", "search_failed", {
      requestId: req.id,
      queryKey,
      statusCode: mapped.statusCode,
      errorCode: err.code || "SERVER_ERROR",
      durationMs: Date.now() - startedAt
    });

    return res.status(mapped.statusCode).json(mapped.body);
  }
}

function createApp(options = {}) {
  const app = express();
  const runtime = options.runtime || createSearchRuntime({
    ...runtimeOptionsFromEnv(options.env || process.env),
    searchRunner: options.searchRunner || searchCancellationRoute
  });

  app.locals.searchRuntime = runtime;
  app.disable("x-powered-by");
  app.set("trust proxy", true);

  app.use(requestLogger);
  app.use(securityHeaders);
  app.use(corsMiddleware());

  app.get("/", sendPage(INDEX_FILE));
  app.get("/index.html", sendPage(INDEX_FILE));
  app.get("/search.html", sendPage(SEARCH_FILE));
  app.get("/favicon.ico", (req, res) => res.status(204).end());

  function sendHealth(req, res) {
    res.json({
      status: runtime.getState().accepting ? "ok" : "shutting_down",
      uptimeSeconds: process.uptime()
    });
  }

  function sendReady(req, res) {
    const state = readinessState(runtime);
    res.status(state.ready ? 200 : 503).json(state);
  }

  app.get("/health", sendHealth);
  app.get("/healthz", sendHealth);
  app.get("/ready", sendReady);
  app.get("/readyz", sendReady);

  app.get("/metrics", (req, res) => {
    res.json(runtime.getMetrics());
  });

  app.get("/search", (req, res) => {
    handleSearch(req, res, {
      deep: false,
      runtime
    });
  });

  app.use((req, res) => {
    res.status(404).json({
      error: "Not found"
    });
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    logStructured("error", "unhandled_http_error", {
      requestId: req.id,
      statusCode: 500,
      errorCode: err.code || "UNHANDLED_ERROR"
    });

    res.status(500).json({
      error: "Server error"
    });
  });

  return app;
}

const app = createApp();
let server = null;

function startServer(port = PORT) {
  server = app.listen(port, () => {
    logStructured("info", "server_started", {
      port,
      url: `http://localhost:${port}`
    });
  });

  return server;
}

async function shutdown(signal) {
  logStructured("info", "server_shutdown_started", { signal });

  await app.locals.searchRuntime.shutdown({
    graceMs: Number(process.env.KICKENUT_SHUTDOWN_GRACE_MS || 5000)
  });

  if (!server) return;

  await new Promise((resolve) => {
    server.close(resolve);
  });

  logStructured("info", "server_shutdown_complete", { signal });
}

if (require.main === module) {
  startServer();

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      shutdown(signal)
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
  }
}

module.exports = {
  app,
  buildResultResponse,
  canonicalResultTarget,
  createApp,
  handleSearch,
  mapSearchError,
  readinessState,
  securityHeaders,
  server,
  shutdown,
  startServer
};
