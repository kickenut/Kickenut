const path = require("path");
const verifiedResults = require("./data/verifiedResults");
const { canonicalReviewUrl } = require("./reviewQueue");
const { readJsonFile, writeJsonFileAtomic } = require("./jsonStorage");

const DEFAULT_VERIFIED_HEALTH_FILE = path.join(__dirname, "data", "verifiedHealth.json");
const DEFAULT_TIMEOUT_MS = 7000;
const NEEDS_REVIEW_FAILURE_COUNT = 3;
const FAILED_FAILURE_COUNT = 5;

const SOFT_404_TERMS = [
  "die gesuchte seite wurde leider nicht gefunden",
  "seite nicht gefunden",
  "not found",
  "404 not found",
  "page not found",
  "we can't find that page",
  "we can’t find that page",
  "this page doesn't exist",
  "this page doesn’t exist",
  "the requested page could not be found"
];

const PARKING_TERMS = [
  "domain for sale",
  "buy this domain",
  "parked domain",
  "godaddy parking",
  "namecheap parking",
  "hugedomains",
  "this domain is available",
  "coming soon"
];

const CANCELLATION_TERMS = [
  "cancel",
  "cancellation",
  "cancel subscription",
  "cancel your subscription",
  "unsubscribe",
  "cancel membership",
  "end subscription",
  "terminate subscription",
  "kuendigen",
  "kuendigung",
  "kundigen",
  "kundigung",
  "abo kuendigen",
  "vertrag kuendigen"
];

const ACCOUNT_TERMS = [
  "account",
  "billing",
  "manage",
  "manage subscription",
  "membership",
  "plan",
  "services",
  "subscription",
  "subscriptions"
];

const LOGIN_TERMS = [
  "log in",
  "login",
  "sign in",
  "signin",
  "anmelden"
];

const GENERIC_HELP_PATHS = new Set([
  "/help",
  "/support",
  "/hc",
  "/contact",
  "/customer-service"
]);

function normaliseText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss");
}

function hasAny(text, terms) {
  const haystack = normaliseText(text);
  return terms.some((term) => haystack.includes(normaliseText(term)));
}

function safeUrl(value, base) {
  try {
    const url = new URL(value, base);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function getHostname(value) {
  try {
    return new URL(String(value || "")).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function getComparableDomain(value) {
  const hostname = getHostname(value);
  if (!hostname) return "";

  const labels = hostname.split(".");
  if (labels.length <= 2) return hostname;

  const lastThree = labels.slice(-3).join(".");
  if (/\.com\.au$/.test(lastThree) || /\.co\.uk$/.test(lastThree) || /\.com\.br$/.test(lastThree)) {
    return lastThree;
  }

  return labels.slice(-2).join(".");
}

function isSameCompanyNetwork(originalUrl, finalUrl) {
  const originalDomain = getComparableDomain(originalUrl);
  const finalDomain = getComparableDomain(finalUrl);
  return Boolean(originalDomain && finalDomain && originalDomain === finalDomain);
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function getTitleFromHtml(html) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripHtml(match[1]) : "";
}

function detectSignals(result, page = {}) {
  const text = [
    page.url,
    page.title,
    page.text
  ].filter(Boolean).join(" ");

  const signals = [];
  if (hasAny(text, CANCELLATION_TERMS)) signals.push("cancellation");
  if (hasAny(text, ACCOUNT_TERMS)) signals.push("subscription_or_account_management");
  if (hasAny(text, LOGIN_TERMS)) signals.push("login_or_account_access");

  return [...new Set(signals)];
}

function isSoft404Page(page) {
  const text = `${page.url || ""} ${page.title || ""} ${page.text || ""}`;
  return hasAny(text, SOFT_404_TERMS);
}

function isParkingPage(page) {
  const text = `${page.title || ""} ${page.text || ""}`;
  return hasAny(text, PARKING_TERMS);
}

function isHomepageOnlyRedirect(originalUrl, finalUrl) {
  if (canonicalReviewUrl(originalUrl) === canonicalReviewUrl(finalUrl)) return false;

  try {
    const final = new URL(finalUrl);
    const cleanPath = final.pathname.replace(/\/+$/, "") || "/";
    return cleanPath === "/";
  } catch {
    return false;
  }
}

function isGenericHelpHomepage(finalUrl, page) {
  try {
    const url = new URL(finalUrl);
    const cleanPath = url.pathname.replace(/\/+$/, "") || "/";
    const titleText = normaliseText(`${page.title || ""} ${page.text || ""}`).slice(0, 1000);
    return GENERIC_HELP_PATHS.has(cleanPath) || (
      cleanPath.split("/").filter(Boolean).length <= 1 &&
      (titleText.includes("help center") || titleText.includes("support center") || titleText.includes("support homepage"))
    );
  } catch {
    return false;
  }
}

function readVerifiedHealth(filePath = DEFAULT_VERIFIED_HEALTH_FILE) {
  return readJsonFile(filePath, [], {
    validate: Array.isArray
  });
}

function writeVerifiedHealth(entries, filePath = DEFAULT_VERIFIED_HEALTH_FILE) {
  writeJsonFileAtomic(filePath, entries);
}

async function fetchVerifiedPage(url, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9,de;q=0.6",
        "user-agent": "KickenutHealthCheck/1.0"
      }
    });

    const contentType = response.headers?.get?.("content-type") || "";
    const html = await response.text();
    const finalUrl = response.url || url;

    return {
      ok: true,
      url: finalUrl,
      status: response.status || 0,
      contentType,
      title: getTitleFromHtml(html),
      text: stripHtml(html).slice(0, 10000)
    };
  } catch (err) {
    return {
      ok: false,
      error: err?.name === "AbortError" ? "timeout" : "fetch_failed",
      message: err?.message || ""
    };
  } finally {
    clearTimeout(timeout);
  }
}

function classifyPage(result, page) {
  const finalUrl = page.url || result.url;
  const detectedSignals = detectSignals(result, page);
  const hasRouteSignals = detectedSignals.includes("cancellation") ||
    detectedSignals.includes("subscription_or_account_management");

  if ([401, 403, 429].includes(Number(page.status))) {
    return {
      statusType: "careful_warning",
      reason: `HTTP ${page.status}: access is restricted or rate limited. This can be normal for login/account pages.`,
      detectedSignals
    };
  }

  if (page.status === 404) {
    return { statusType: "failure", reason: "HTTP 404 Not Found.", detectedSignals };
  }

  if (page.status === 410) {
    return { statusType: "failure", reason: "HTTP 410 Gone.", detectedSignals };
  }

  if (page.status >= 500) {
    return { statusType: "failure", reason: `HTTP ${page.status}: server error.`, detectedSignals };
  }

  if (!isSameCompanyNetwork(result.url, finalUrl)) {
    return { statusType: "failure", reason: "Redirect ended on a different company/domain network.", detectedSignals };
  }

  if (isSoft404Page(page)) {
    return { statusType: "failure", reason: "Soft-404 style page detected.", detectedSignals };
  }

  if (isParkingPage(page)) {
    return { statusType: "failure", reason: "Parking/domain-for-sale page detected.", detectedSignals };
  }

  if (isHomepageOnlyRedirect(result.url, finalUrl) && !hasRouteSignals) {
    return { statusType: "failure", reason: "Redirected to a homepage without cancellation/subscription/account-management signals.", detectedSignals };
  }

  if (isGenericHelpHomepage(finalUrl, page) && !detectedSignals.includes("cancellation")) {
    return { statusType: "failure", reason: "Generic help/support homepage without clear cancellation intent.", detectedSignals };
  }

  if (!hasRouteSignals) {
    return { statusType: "failure", reason: "Page no longer shows strong cancellation/subscription/account-management signals.", detectedSignals };
  }

  return {
    statusType: "healthy",
    reason: "Verified URL is reachable and still shows relevant cancellation/subscription/account-management signals.",
    detectedSignals
  };
}

function buildStatus(statusType, previous = {}) {
  const previousFailureCount = Number(previous.failureCount || 0);

  if (statusType === "healthy") {
    return {
      status: "healthy",
      failureCount: 0
    };
  }

  if (statusType === "careful_warning") {
    return {
      status: "warning",
      failureCount: previousFailureCount
    };
  }

  const failureCount = previousFailureCount + 1;
  let status = "warning";
  if (failureCount >= FAILED_FAILURE_COUNT) status = "failed";
  else if (failureCount >= NEEDS_REVIEW_FAILURE_COUNT) status = "needs_review";

  return {
    status,
    failureCount
  };
}

async function checkVerifiedResult(result, previousEntry = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const canonicalUrl = canonicalReviewUrl(result.url);
  const fetched = await fetchVerifiedPage(result.url, options);

  if (!canonicalUrl) {
    return {
      company: result.company,
      url: result.url,
      canonicalUrl: "",
      status: "failed",
      httpStatus: null,
      finalUrl: "",
      redirectChanged: false,
      lastChecked: now,
      lastGood: previousEntry.lastGood || "",
      failureCount: Number(previousEntry.failureCount || 0) + 1,
      reason: "Invalid verified URL.",
      title: "",
      detectedSignals: [],
      notes: result.notes || ""
    };
  }

  if (!fetched.ok) {
    const statusParts = buildStatus("failure", previousEntry);
    return {
      company: result.company,
      url: result.url,
      canonicalUrl,
      status: statusParts.status,
      httpStatus: null,
      finalUrl: "",
      redirectChanged: false,
      lastChecked: now,
      lastGood: previousEntry.lastGood || "",
      failureCount: statusParts.failureCount,
      reason: fetched.error === "timeout" ? "Timeout while fetching verified URL." : "Fetch failed while checking verified URL.",
      title: "",
      detectedSignals: [],
      notes: result.notes || ""
    };
  }

  const classification = classifyPage(result, fetched);
  const statusParts = buildStatus(classification.statusType, previousEntry);
  const finalCanonical = canonicalReviewUrl(fetched.url);
  const redirectChanged = Boolean(finalCanonical && finalCanonical !== canonicalUrl);

  return {
    company: result.company,
    url: result.url,
    canonicalUrl,
    status: statusParts.status,
    httpStatus: fetched.status,
    finalUrl: fetched.url,
    redirectChanged,
    lastChecked: now,
    lastGood: statusParts.status === "healthy" ? now : (previousEntry.lastGood || ""),
    failureCount: statusParts.failureCount,
    reason: classification.reason,
    title: fetched.title || "",
    detectedSignals: classification.detectedSignals,
    notes: result.notes || ""
  };
}

async function runVerifiedHealthCheck(options = {}) {
  const healthFile = options.healthFile || DEFAULT_VERIFIED_HEALTH_FILE;
  const previousEntries = readVerifiedHealth(healthFile);
  const previousByUrl = new Map(previousEntries.map((entry) => [entry.canonicalUrl, entry]));
  const sourceResults = options.verifiedResults || verifiedResults;
  const entries = [];

  for (const result of sourceResults) {
    const canonicalUrl = canonicalReviewUrl(result.url);
    const previousEntry = previousByUrl.get(canonicalUrl) || {};
    entries.push(await checkVerifiedResult(result, previousEntry, options));
  }

  writeVerifiedHealth(entries, healthFile);

  return {
    checked: entries.length,
    healthy: entries.filter((entry) => entry.status === "healthy").length,
    warning: entries.filter((entry) => entry.status === "warning").length,
    needs_review: entries.filter((entry) => entry.status === "needs_review").length,
    failed: entries.filter((entry) => entry.status === "failed").length,
    entries
  };
}

module.exports = {
  DEFAULT_VERIFIED_HEALTH_FILE,
  checkVerifiedResult,
  classifyPage,
  readVerifiedHealth,
  runVerifiedHealthCheck,
  writeVerifiedHealth
};
