const SECRET_QUERY_KEYS = new Set([
  "access_token",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "client_secret",
  "code",
  "key",
  "password",
  "refresh_token",
  "secret",
  "signature",
  "token"
]);

function isDiagnosticModeEnabled(env = process.env) {
  return env.NODE_ENV !== "production" && env.KICKENUT_SEARCH_DIAGNOSTICS === "1";
}

function shouldIncludeDiagnosticsInResponse(req, env = process.env) {
  return (
    isDiagnosticModeEnabled(env) &&
    env.KICKENUT_SEARCH_DIAGNOSTICS_RESPONSE === "1" &&
    String(req?.query?.diagnostics || "") === "1"
  );
}

function redactUrl(value) {
  try {
    const url = new URL(String(value || ""));

    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.set(key, "[redacted]");
      }
    }

    return url.href;
  } catch {
    return String(value || "");
  }
}

function safeValue(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      code: value.code || "",
      message: value.message
    };
  }

  if (Array.isArray(value)) return value.map(safeValue);

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, safeValue(entryValue)])
    );
  }

  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    return redactUrl(value);
  }

  return value;
}

function safeFields(fields = {}) {
  return safeValue(fields);
}

function createSearchDiagnostics(options = {}) {
  const enabled = Boolean(options.enabled);
  const startedAt = Date.now();
  const trace = {
    requestId: options.requestId || "",
    query: String(options.query || ""),
    normalizedQuery: String(options.normalizedQuery || ""),
    startedAt: new Date(startedAt).toISOString(),
    events: [],
    stages: [],
    final: {}
  };

  function nowElapsedMs() {
    return Date.now() - startedAt;
  }

  function event(name, fields = {}) {
    if (!enabled) return;

    trace.events.push({
      atMs: nowElapsedMs(),
      name,
      ...safeFields(fields)
    });
  }

  function record(field, value) {
    if (!enabled) return;
    trace[field] = safeValue(value);
  }

  function beginStage(name, fields = {}) {
    if (!enabled) return null;

    const stage = {
      id: trace.stages.length + 1,
      name,
      startedAtMs: nowElapsedMs(),
      ...safeFields(fields)
    };

    trace.stages.push(stage);
    return stage;
  }

  function endStage(stage, fields = {}) {
    if (!enabled || !stage) return;

    Object.assign(stage, safeFields(fields), {
      durationMs: Math.max(0, nowElapsedMs() - stage.startedAtMs)
    });
  }

  function finish(fields = {}) {
    if (!enabled) return;

    trace.final = {
      ...trace.final,
      ...safeFields(fields),
      durationMs: nowElapsedMs()
    };
  }

  function toJSON() {
    return safeValue(trace);
  }

  return {
    enabled,
    beginStage,
    endStage,
    event,
    finish,
    record,
    toJSON
  };
}

module.exports = {
  createSearchDiagnostics,
  isDiagnosticModeEnabled,
  shouldIncludeDiagnosticsInResponse
};
