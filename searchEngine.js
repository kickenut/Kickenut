const path = require("path");
const verifiedResults = require("./data/verifiedResults");
const companySeeds = require("./data/companySeeds");
const { readJsonFile, writeJsonFileAtomic } = require("./jsonStorage");

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_PAGES = 56;
const DISCOVERY_TIMEOUT_MS = 2500;
const DEFAULT_SEARCH_TIME_BUDGET_MS = 10000;
const DEFAULT_DEEP_SEARCH_TIME_BUDGET_MS = 22000;
const DEFAULT_SEED_CANDIDATE_TIMEOUT_MS = 1200;
const DEFAULT_START_URL_TIMEOUT_MS = 1800;
const DEFAULT_ROUTE_PATH_TIMEOUT_MS = 900;
const DISCOVERED_DOMAINS_FILE = path.join(__dirname, "data", "discoveredDomains.json");
const DEFAULT_DISCOVERED_DOMAIN_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_DISCOVERED_DOMAIN_CACHE_MAX_ENTRIES = 250;

const STRONG_GERMAN_TERMS = [
  "vertraege hier kuendigen",
  "vertrage hier kundigen",
  "abo kuendigen",
  "abo kundigen",
  "kuendigen",
  "kundigen",
  "mitgliedschaft kuendigen",
  "mitgliedschaft kundigen",
  "vertrag kuendigen",
  "vertrag kundigen",
  "kuendigungsbutton",
  "kundigungsbutton",
  "kuendigung",
  "kundigung",
  "jetzt kuendigen",
  "jetzt kundigen",
  "vertrag beenden",
  "mitgliedschaft beenden"
];

const STRONG_ENGLISH_TERMS = [
  "cancel",
  "cancellation",
  "cancel subscription",
  "cancel a subscription",
  "cancel your subscription",
  "cancel subscriptions",
  "unsubscribe",
  "cancel membership",
  "end subscription",
  "terminate subscription",
  "close account",
  "delete account",
  "billing cancellation",
  "cancel billing",
  "manage subscription",
  "manage subscriptions",
  "manage plan",
  "subscription management",
  "manage your subscription"
];

const MEDIUM_ROUTE_TERMS = [
  "account",
  "billing",
  "subscription",
  "subscriptions",
  "membership",
  "memberships",
  "manage",
  "plan",
  "plans",
  "settings",
  "support",
  "help",
  "legal",
  "konto",
  "zahlung",
  "mitgliedschaft",
  "abonnement",
  "abonnements"
];

const NEGATIVE_TERMS = [
  "reddit",
  "quora",
  "forum",
  "forums",
  "community",
  "blog",
  "news",
  "youtube.com/watch",
  "tiktok",
  "instagram",
  "facebook",
  "we cancel for you",
  "cancel on your behalf",
  "affiliate",
  "careers",
  "press",
  "investor relations",
  "pricing",
  "start free trial",
  "subscribe now"
];

const SOFT_404_TERMS = [
  "die gesuchte seite wurde leider nicht gefunden",
  "seite wurde leider nicht gefunden",
  "seite nicht gefunden",
  "not found",
  "404 not found",
  "404 error",
  "404",
  "page not found",
  "we can't find that page",
  "we can’t find that page",
  "we can't find the page you're looking for",
  "we couldn’t find the page you’re looking for",
  "the page you're looking for can't be found",
  "the page you are looking for can't be found",
  "this page doesn't exist",
  "this page doesn’t exist",
  "the requested page could not be found",
  "page unavailable",
  "error page"
];

const PARKING_TERMS = [
  "domain for sale",
  "buy this domain",
  "parked domain",
  "godaddy parking",
  "namecheap parking",
  "hugedomains",
  "this domain is available",
  "sedo",
  "coming soon"
];

const STRONG_EXIT_URL_TERMS = [
  "cancel",
  "cancellation",
  "unsubscribe",
  "cancel-subscription",
  "cancel-membership",
  "cancel-account",
  "close-account",
  "delete-account",
  "end-subscription",
  "terminate-subscription",
  "manage-subscription",
  "manage-subscriptions",
  "subscription-management",
  "billing-cancellation",
  "account-cancellation",
  "membership-cancellation",
  "kuendigung",
  "kundigung",
  "abo-kuendigen",
  "vertrag-kuendigen",
  "mitgliedschaft-kuendigen"
];

const GERMAN_CANDIDATE_MARKERS = [
  ".de",
  "/de",
  "/de-de",
  "/deutschland",
  "kuendigung",
  "kundigung",
  "abo-kuendigen",
  "vertrag-kuendigen",
  "mitgliedschaft-kuendigen",
  "kuendigungsbutton",
  "vertraege-hier-kuendigen"
];

const ORGANIZATION_HINT_TERMS = [
  "business",
  "company",
  "corporation",
  "organization",
  "organisation",
  "brand",
  "service",
  "subscription",
  "streaming",
  "software",
  "platform",
  "commerce",
  "retailer",
  "website",
  "product"
];

const DOMAIN_SUFFIXES = [".com", ".com.au", ".de", ".co", ".io", ".app"];

function isDeferredSearchKey(key) {
  return (
    key.startsWith("disney") ||
    key.startsWith("adobe") ||
    key === "youtubepremium" ||
    key.startsWith("youtubepremium")
  );
}

const DIRECT_PATHS_GERMAN = [
  "/kuendigung",
  "/kundigung",
  "/de/kuendigung",
  "/de-de/kuendigung",
  "/abo-kuendigen",
  "/vertrag-kuendigen",
  "/mitgliedschaft-kuendigen",
  "/kuendigungsbutton",
  "/vertraege-hier-kuendigen"
];

const DIRECT_PATHS_ENGLISH = [
  "/cancel",
  "/cancellation",
  "/unsubscribe",
  "/cancel-subscription",
  "/manage-subscription",
  "/subscription",
  "/subscriptions",
  "/account/subscriptions",
  "/billing",
  "/account",
  "/payments",
  "/manage",
  "/membership",
  "/memberships",
  "/delete-account",
  "/close-account",
  "/help",
  "/help/account",
  "/help/billing",
  "/help/subscriptions",
  "/support",
  "/support/account",
  "/support/billing",
  "/support/subscriptions"
];

function normaliseText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss");
}

function normaliseKey(value) {
  return normaliseText(value).replace(/[^a-z0-9]/g, "");
}

function normaliseDomain(value) {
  return String(value || "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split(/[/?#]/)[0]
    .toLowerCase();
}

function getRawHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function getHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
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

function deriveOfficialSiteUrl(value, companyOrSeed = "") {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (isTranslationHost(url.hostname)) return "";

    const seed = typeof companyOrSeed === "object" && companyOrSeed
      ? companyOrSeed
      : getCompanySeed(companyOrSeed);

    if (seed) {
      if (!isOfficialUrl(url.href, seed)) return "";
      return getSeedEnglishOfficialSite(seed) || getSeedEnglishOfficialDomainSite(seed) || "";
    }

    if (isGermanDomain(url.hostname)) return "";

    const englishLocaleHome = deriveEnglishLocaleHomepage(url);
    return englishLocaleHome || `${url.protocol}//${url.host}/`;
  } catch {
    return "";
  }
}

function isTranslationHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return (
    host.includes("translate.google") ||
    host.includes("translate.goog") ||
    host.includes("translateusercontent")
  );
}

function isGermanDomain(hostname) {
  const host = String(hostname || "").replace(/^www\./i, "").toLowerCase();
  return host === "de" || host.endsWith(".de");
}

function isEnglishGlobalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol)) return false;
    if (isTranslationHost(url.hostname) || isGermanDomain(url.hostname)) return false;

    const path = normaliseText(url.pathname || "/").replace(/\/+$/, "") || "/";
    return path === "/" || Boolean(deriveEnglishLocaleHomepage(url));
  } catch {
    return false;
  }
}

function getHomepageFromUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const englishLocaleHome = deriveEnglishLocaleHomepage(url);
    return englishLocaleHome || `${url.protocol}//${url.host}/`;
  } catch {
    return "";
  }
}

function isServiceSubdomain(value) {
  try {
    const host = new URL(String(value || "").startsWith("http") ? value : `https://${value}`).hostname
      .replace(/^www\./i, "")
      .toLowerCase();
    const firstLabel = host.split(".")[0];

    return [
      "account",
      "accounts",
      "billing",
      "help",
      "my",
      "payments",
      "play",
      "support"
    ].includes(firstLabel);
  } catch {
    return false;
  }
}

function getSeedEnglishOfficialSite(seed) {
  for (const url of seed?.englishStartUrls || []) {
    const cleanUrl = safeUrl(url);
    if (!cleanUrl || !isOfficialUrl(cleanUrl, seed)) continue;
    if (!isEnglishGlobalUrl(cleanUrl)) continue;
    if (isServiceSubdomain(cleanUrl)) continue;

    return getHomepageFromUrl(cleanUrl);
  }

  for (const domain of seed?.officialDomains || []) {
    const cleanDomain = normaliseDomain(domain);
    if (!cleanDomain || isGermanDomain(cleanDomain)) continue;
    if (isServiceSubdomain(cleanDomain)) continue;

    return `https://${cleanDomain}/`;
  }

  for (const url of seed?.englishStartUrls || []) {
    const cleanUrl = safeUrl(url);
    if (!cleanUrl || !isOfficialUrl(cleanUrl, seed)) continue;
    if (!isEnglishGlobalUrl(cleanUrl)) continue;

    return getHomepageFromUrl(cleanUrl);
  }

  return "";
}

function getSeedEnglishOfficialDomainSite(seed) {
  for (const domain of seed?.officialDomains || []) {
    const cleanDomain = normaliseDomain(domain);
    if (!cleanDomain || isGermanDomain(cleanDomain)) continue;
    if (isServiceSubdomain(cleanDomain)) continue;

    return `https://${cleanDomain}/`;
  }

  return "";
}

function deriveKnownOfficialSiteFallback(seed) {
  if (!seed || !companySeeds.includes(seed)) return "";

  return getSeedEnglishOfficialSite(seed) || getSeedEnglishOfficialDomainSite(seed) || "";
}

function deriveEnglishLocaleHomepage(url) {
  const segments = (url.pathname || "")
    .split("/")
    .filter(Boolean)
    .map((segment) => normaliseText(segment));

  if (!segments.length) return "";

  const first = segments[0];
  const second = segments[1] || "";
  const englishLocales = new Set(["en", "en-us", "en-gb", "en-au", "en-ca"]);

  if (englishLocales.has(first)) return `${url.protocol}//${url.host}/${first}/`;
  if (first === "-" && second === "en") return `${url.protocol}//${url.host}/-/en/`;
  if (/^[a-z]{2}-en$/.test(first)) return `${url.protocol}//${url.host}/${first}/`;

  return "";
}

function getCompanyLabel(query) {
  const text = String(query || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split(/[/?#]/)[0]
    .replace(/\.(com|de|co|io|app|com\.au)$/i, "")
    .replace(/[+]/g, " plus ")
    .replace(/[-_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text || String(query || "").trim();
}

function normaliseCompanyForDomain(query) {
  return normaliseText(query)
    .replace(/\+/g, " plus ")
    .replace(/&/g, " and ")
    .replace(/\bplus\b/g, "plus")
    .replace(/[^a-z0-9]+/g, "");
}

function getBrandEvidenceTokens(query) {
  return normaliseText(getCompanyLabel(query))
    .replace(/\+/g, " plus ")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !["the", "app", "inc", "llc", "ltd", "subscription", "premium"].includes(token));
}

function hasStrongBrandEvidence(query, page) {
  const compactQuery = normaliseKey(getCompanyLabel(query));
  const text = normaliseKey(`${page?.title || ""} ${page?.text || ""}`);
  const tokens = getBrandEvidenceTokens(query);

  if (compactQuery.length >= 4 && text.includes(compactQuery)) return true;
  if (!tokens.length) return false;

  const matches = tokens.filter((token) => text.includes(token));
  return matches.length === tokens.length || (tokens.length > 1 && matches.length >= 2);
}

function hasAustralianHint(query) {
  return /\b(australia|australian|com\.au|\.au| au)\b/i.test(String(query || ""));
}

function readDiscoveredDomainCache(cacheFile = DISCOVERED_DOMAINS_FILE) {
  return readJsonFile(cacheFile, {}, {
    validate: (cache) => cache && typeof cache === "object" && !Array.isArray(cache)
  });
}

function writeDiscoveredDomainCache(cache, cacheFile = DISCOVERED_DOMAINS_FILE) {
  try {
    writeJsonFileAtomic(cacheFile, cache);
  } catch {
    // Cache writes are helpful, not required for search.
  }
}

function getDiscoveredDomainCacheTtlMs(options = {}) {
  const value = Number(options.discoveryCacheTtlMs || DEFAULT_DISCOVERED_DOMAIN_CACHE_TTL_MS);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DISCOVERED_DOMAIN_CACHE_TTL_MS;
}

function getDiscoveredDomainCacheMaxEntries(options = {}) {
  const value = Number(options.discoveryCacheMaxEntries || DEFAULT_DISCOVERED_DOMAIN_CACHE_MAX_ENTRIES);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_DISCOVERED_DOMAIN_CACHE_MAX_ENTRIES;
}

function isExpiredDiscoveredDomainEntry(entry, options = {}) {
  const ttlMs = getDiscoveredDomainCacheTtlMs(options);
  if (ttlMs <= 0) return false;

  const savedAt = Date.parse(entry?.savedAt || "");
  if (!Number.isFinite(savedAt)) return true;

  return Date.now() - savedAt > ttlMs;
}

function pruneDiscoveredDomainCache(cache, options = {}) {
  const maxEntries = getDiscoveredDomainCacheMaxEntries(options);
  const entries = Object.entries(cache || {})
    .filter(([, entry]) => entry?.domain && !isExpiredDiscoveredDomainEntry(entry, options))
    .sort((a, b) => Date.parse(b[1].savedAt || 0) - Date.parse(a[1].savedAt || 0))
    .slice(0, maxEntries);

  return Object.fromEntries(entries);
}

function isSearchAborted(options = {}) {
  return Boolean(options.signal?.aborted);
}

function getRemainingBudgetMs(options = {}) {
  if (isSearchAborted(options)) return 0;
  if (!options.deadlineMs) return Infinity;
  return Math.max(0, options.deadlineMs - Date.now());
}

function hasSearchBudget(options = {}, minimumMs = 50) {
  return getRemainingBudgetMs(options) > minimumMs;
}

function getBudgetedTimeout(options = {}, fallbackMs = DEFAULT_TIMEOUT_MS) {
  const remaining = getRemainingBudgetMs(options);
  if (!Number.isFinite(remaining)) return fallbackMs;
  return Math.max(1, Math.min(fallbackMs, remaining));
}

function buildTemporarySeed(query, domain, source = "discovered-domain") {
  const cleanDomain = normaliseDomain(domain);
  const company = getCompanyLabel(query);

  return {
    id: `${source}-${normaliseKey(company || cleanDomain)}`,
    company: company || cleanDomain,
    aliases: [company, cleanDomain].filter(Boolean),
    officialDomains: [cleanDomain],
    germanStartUrls: [
      `https://${cleanDomain}/de`,
      `https://${cleanDomain}/de-de`,
      `https://${cleanDomain}/deutschland`,
      `https://${cleanDomain}/help/de`,
      `https://${cleanDomain}/support/de`
    ],
    englishStartUrls: [
      `https://${cleanDomain}/`,
      `https://${cleanDomain}/help`,
      `https://${cleanDomain}/support`,
      `https://${cleanDomain}/account`,
      `https://${cleanDomain}/billing`,
      `https://${cleanDomain}/subscription`,
      `https://${cleanDomain}/cancel`,
      `https://${cleanDomain}/unsubscribe`
    ],
    candidateUrls: [],
    discoverySource: source
  };
}

function getCachedDiscoveredSeed(query, options = {}) {
  if (options.disableDiscoveryCache) return null;

  const cache = pruneDiscoveredDomainCache(
    readDiscoveredDomainCache(options.discoveryCacheFile),
    options
  );
  const entry = cache[normaliseKey(query)];
  if (!entry?.domain) return null;

  return buildTemporarySeed(entry.company || query, entry.domain, entry.source || "cached-domain");
}

function saveDiscoveredSeed(query, seed, options = {}) {
  if (options.disableDiscoveryCache || !seed?.officialDomains?.[0]) return;

  const cacheFile = options.discoveryCacheFile || DISCOVERED_DOMAINS_FILE;
  const cache = pruneDiscoveredDomainCache(readDiscoveredDomainCache(cacheFile), options);
  cache[normaliseKey(query)] = {
    company: seed.company,
    domain: seed.officialDomains[0],
    source: seed.discoverySource || "discovered-domain",
    savedAt: new Date().toISOString()
  };
  writeDiscoveredDomainCache(cache, cacheFile);
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

function extractLinks(html, baseUrl) {
  const links = [];
  const linkRegex = /<a\b[^>]*href=["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi;
  const formRegex = /<form\b[^>]*action=["']?([^"'\s>]+)["']?[^>]*>/gi;
  let match;

  while ((match = linkRegex.exec(String(html || ""))) !== null && links.length < 260) {
    const href = safeUrl(match[1], baseUrl);
    if (!href) continue;

    links.push({
      title: stripHtml(match[2]).slice(0, 180),
      link: href,
      source: "official-page-link"
    });
  }

  while ((match = formRegex.exec(String(html || ""))) !== null && links.length < 300) {
    const action = safeUrl(match[1], baseUrl);
    if (!action) continue;

    links.push({
      title: "Form action",
      link: action,
      source: "official-page-form"
    });
  }

  return links;
}

function hasAny(text, terms) {
  const haystack = normaliseText(text);
  return terms.some((term) => haystack.includes(normaliseText(term)));
}

function hasStrongExitWording(value) {
  const text = normaliseText(value).replace(/_/g, "-");
  return STRONG_EXIT_URL_TERMS.some((term) => text.includes(normaliseText(term)));
}

function hasGermanCandidateMarker(value) {
  const text = normaliseText(value).replace(/_/g, "-");
  return GERMAN_CANDIDATE_MARKERS.some((marker) => text.includes(normaliseText(marker)));
}

function isGermanCandidate(candidate = {}) {
  return (
    String(candidate.source || "").includes("german") ||
    hasGermanCandidateMarker(`${candidate.title || ""} ${candidate.link || ""}`)
  );
}

function getAcceptLanguage(url, source = "") {
  const text = normaliseText(`${url || ""} ${source || ""}`);

  if (
    text.includes("/de") ||
    text.includes("deutschland") ||
    text.includes("german") ||
    text.includes("kuend") ||
    text.includes("kund") ||
    text.includes("vertrag") ||
    text.includes("mitgliedschaft")
  ) {
    return "de-DE,de;q=0.9,en;q=0.8";
  }

  return "en-US,en;q=0.9,de;q=0.6";
}

function isOfficialUrl(url, seed) {
  const hostname = getHostname(url);
  if (!hostname || !seed) return false;

  return (seed.officialDomains || []).some((domain) => {
    const cleanDomain = normaliseDomain(domain);
    return hostname === cleanDomain || hostname.endsWith(`.${cleanDomain}`);
  });
}

function isNegativeCandidate(candidate) {
  const text = normaliseText(`${candidate.title || ""} ${candidate.link || ""} ${candidate.pageText || ""}`);
  return NEGATIVE_TERMS.some((term) => text.includes(normaliseText(term)));
}

function isParkingPage(page) {
  if (!page) return false;

  const text = normaliseText(`${page.title || ""} ${page.text || ""}`);
  if (!hasAny(text, PARKING_TERMS)) return false;

  return !hasStrongBrandEvidence(page.expectedBrand || "", page);
}

function isSoft404Page(page) {
  if (!page) return false;

  const text = normaliseText(`${page.url || ""} ${page.title || ""} ${page.text || ""}`);
  return SOFT_404_TERMS.some((term) => text.includes(normaliseText(term)));
}

function isBlockedStatus(status) {
  return [401, 403, 429].includes(Number(status));
}

function looksLikeRoute(candidate) {
  const text = `${candidate.title || ""} ${candidate.link || ""} ${candidate.pageText || ""}`;
  return hasAny(text, [...STRONG_GERMAN_TERMS, ...STRONG_ENGLISH_TERMS, ...MEDIUM_ROUTE_TERMS]);
}

function getVerifiedResult(query) {
  const key = normaliseKey(query);
  if (!key) return null;

  const entries = verifiedResults.map((result) => ({
    result,
    aliases: [result.company, ...(result.aliases || [])].map(normaliseKey).filter(Boolean)
  }));

  const exact = entries.find((entry) => entry.aliases.includes(key));
  if (exact) return formatVerifiedResult(exact.result);

  const partial = entries
    .flatMap((entry) => entry.aliases.map((alias) => ({ alias, result: entry.result })))
    .filter((entry) => entry.alias.length >= 5)
    .sort((a, b) => b.alias.length - a.alias.length)
    .find((entry) => key.includes(entry.alias) || entry.alias.includes(key));

  return partial ? formatVerifiedResult(partial.result) : null;
}

function getCompanySeed(query) {
  const key = normaliseKey(query);
  if (!key) return null;
  if (isDeferredSearchKey(key)) return null;

  const entries = companySeeds.map((seed) => ({
    seed,
    aliases: [seed.company, ...(seed.aliases || [])].map(normaliseKey).filter(Boolean)
  }));

  const exact = entries.find((entry) => entry.aliases.includes(key));
  if (exact) return exact.seed;

  const partial = entries
    .flatMap((entry) => entry.aliases.map((alias) => ({ alias, seed: entry.seed })))
    .filter((entry) => entry.alias.length >= 5)
    .sort((a, b) => b.alias.length - a.alias.length)
    .find((entry) => key.includes(entry.alias) || entry.alias.includes(key));

  if (partial) return partial.seed;

  const possibleDomain = normaliseText(query)
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];

  if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(possibleDomain)) {
    return buildTemporarySeed(possibleDomain, possibleDomain, "domain-search");
  }

  return null;
}

function formatVerifiedResult(result) {
  return {
    company: result.company,
    title: `${result.company} official cancellation route`,
    link: result.url,
    source: "verified",
    confidence: result.confidence || "High",
    verified: true,
    resultType: result.resultType || "Official route",
    tier: result.tier || (result.confidence === "High" ? "Tier 1" : "Tier 2"),
    language: result.language || "",
    notes: result.notes || "Official saved verified result.",
    instruction: result.instruction || "Open the official result and follow the cancellation steps on that page."
  };
}

function formatNoResult(query, seed) {
  const exampleDomain = seed?.officialDomains?.[0] || generateDomainCandidates(query)[0] || "";
  const hint = exampleDomain
    ? ` Try entering the company's official website, for example ${exampleDomain}.`
    : "";
  const officialSite = deriveKnownOfficialSiteFallback(seed);

  return {
    error: `No official cancellation route found yet.${hint}`,
    company: seed?.company || String(query || "").trim(),
    searched: true,
    officialSite,
    notes: seed
      ? "No verified result exists and official-site discovery did not find a clear cancellation page."
      : "Kickenut could not safely identify an official domain or cancellation route yet."
  };
}

async function fetchPage(url, options = {}) {
  if (!hasSearchBudget(options)) return null;

  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = getBudgetedTimeout(options, options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const acceptLanguage = options.acceptLanguage || getAcceptLanguage(url, options.source);
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (options.signal?.aborted) return null;
  options.signal?.addEventListener?.("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": acceptLanguage,
        "user-agent": "Kickenut/1.0"
      }
    });

    const contentType = response.headers?.get?.("content-type") || "";
    const html = await response.text();

    if (!contentType.includes("text/html") && !html.includes("<html")) {
      return null;
    }

    const finalUrl = response.url || url;
    return {
      url: finalUrl,
      status: response.status || 0,
      title: getTitleFromHtml(html),
      html,
      text: stripHtml(html).slice(0, 10000),
      links: extractLinks(html, finalUrl)
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener?.("abort", abortFromParent);
  }
}

async function fetchJson(url, options = {}) {
  if (!hasSearchBudget(options)) return null;

  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = getBudgetedTimeout(options, options.discoveryTimeoutMs || DISCOVERY_TIMEOUT_MS);
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (options.signal?.aborted) return null;
  options.signal?.addEventListener?.("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": "Kickenut/1.0"
      }
    });

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener?.("abort", abortFromParent);
  }
}

function buildWikidataSearchUrl(query) {
  const params = new URLSearchParams({
    action: "wbsearchentities",
    search: getCompanyLabel(query),
    language: "en",
    format: "json",
    limit: "5",
    origin: "*"
  });

  return `https://www.wikidata.org/w/api.php?${params.toString()}`;
}

function buildWikidataEntityUrl(entityId) {
  return `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(entityId)}.json`;
}

function getEntityText(searchEntity, entity) {
  const labels = entity?.labels || {};
  const descriptions = entity?.descriptions || {};

  return [
    searchEntity?.label,
    searchEntity?.description,
    labels.en?.value,
    labels.de?.value,
    descriptions.en?.value,
    descriptions.de?.value
  ].filter(Boolean).join(" ");
}

function scoreWikidataEntity(query, searchEntity, entity) {
  const queryKey = normaliseKey(getCompanyLabel(query));
  const text = getEntityText(searchEntity, entity);
  const labelKey = normaliseKey(searchEntity?.label || entity?.labels?.en?.value || "");
  const description = normaliseText(text);
  let score = 0;

  if (labelKey === queryKey) score += 100;
  else if (queryKey.length >= 4 && (labelKey.includes(queryKey) || queryKey.includes(labelKey))) score += 55;

  if (hasAny(description, ORGANIZATION_HINT_TERMS)) score += 35;
  if (entity?.claims?.P856?.length) score += 60;

  return score;
}

function extractOfficialWebsiteUrls(entity) {
  return (entity?.claims?.P856 || [])
    .map((claim) => claim?.mainsnak?.datavalue?.value)
    .filter((value) => typeof value === "string")
    .map((value) => safeUrl(value.startsWith("http") ? value : `https://${value}`))
    .filter(Boolean);
}

function hostMatchesCandidateDomain(url, domain) {
  const host = getRawHostname(url);
  const cleanDomain = normaliseDomain(domain);
  return host === cleanDomain || host === `www.${cleanDomain}`;
}

function generateDomainCandidates(query) {
  const base = normaliseCompanyForDomain(getCompanyLabel(query));
  if (!base || base.length < 3) return [];

  const domains = [
    ...DOMAIN_SUFFIXES.map((suffix) => `${base}${suffix}`),
    `get${base}.com`
  ];

  if (hasAustralianHint(query) && !domains.includes(`${base}.com.au`)) {
    domains.push(`${base}.com.au`);
  }

  return [...new Set(domains)];
}

async function validateOfficialWebsite(query, url, options = {}) {
  const cleanUrl = safeUrl(url.startsWith("http") ? url : `https://${url}`);
  if (!cleanUrl) return null;

  const originalDomain = normaliseDomain(cleanUrl);
  if (!originalDomain) return null;

  const page = await fetchPage(cleanUrl, {
    ...options,
    timeoutMs: options.discoveryTimeoutMs || DISCOVERY_TIMEOUT_MS,
    source: "domain-discovery"
  });

  if (!page || page.status >= 400 || isSoft404Page(page)) return null;
  if (options.strictHost && !hostMatchesCandidateDomain(page.url || cleanUrl, originalDomain)) return null;

  const pageForBrand = { ...page, expectedBrand: query };
  if (isParkingPage(pageForBrand)) return null;
  if (!hasStrongBrandEvidence(query, pageForBrand)) return null;

  return buildTemporarySeed(query, getHostname(page.url || cleanUrl) || originalDomain, options.source || "discovered-domain");
}

async function discoverSeedFromWikidata(query, options = {}) {
  const searchData = await fetchJson(buildWikidataSearchUrl(query), options);
  const searchResults = Array.isArray(searchData?.search) ? searchData.search : [];
  const inspected = [];

  for (const searchEntity of searchResults.slice(0, 5)) {
    if (!hasSearchBudget(options)) break;
    if (!searchEntity?.id) continue;

    const entityData = await fetchJson(buildWikidataEntityUrl(searchEntity.id), options);
    const entity = entityData?.entities?.[searchEntity.id];
    if (!entity) continue;

    inspected.push({
      searchEntity,
      entity,
      score: scoreWikidataEntity(query, searchEntity, entity)
    });
  }

  inspected.sort((a, b) => b.score - a.score);

  for (const entry of inspected) {
    if (!hasSearchBudget(options)) break;
    if (entry.score < 60) continue;

    for (const websiteUrl of extractOfficialWebsiteUrls(entry.entity)) {
      if (!hasSearchBudget(options)) break;

      const seed = await validateOfficialWebsite(query, websiteUrl, {
        ...options,
        source: "wikidata-official-website"
      });

      if (seed) return seed;
    }
  }

  return null;
}

async function discoverSeedFromDomainGuess(query, options = {}) {
  for (const domain of generateDomainCandidates(query)) {
    if (!hasSearchBudget(options)) break;

    const seed = await validateOfficialWebsite(query, `https://${domain}/`, {
      ...options,
      strictHost: true,
      source: "safe-domain-guess"
    });

    if (seed) return seed;
  }

  return null;
}

async function discoverCompanySeed(query, options = {}) {
  const key = normaliseKey(query);
  if (!key || isDeferredSearchKey(key)) return null;
  if (!hasSearchBudget(options)) return null;

  const cached = getCachedDiscoveredSeed(query, options);
  if (cached) return cached;

  const wikidataSeed = await discoverSeedFromWikidata(query, options);
  if (wikidataSeed) {
    saveDiscoveredSeed(query, wikidataSeed, options);
    return wikidataSeed;
  }

  const guessedSeed = await discoverSeedFromDomainGuess(query, options);
  if (guessedSeed) {
    saveDiscoveredSeed(query, guessedSeed, options);
    return guessedSeed;
  }

  return null;
}

function buildInitialCandidates(seed) {
  const candidates = [];

  function push(url, source, priority) {
    const cleanUrl = safeUrl(url);
    if (!cleanUrl || !isOfficialUrl(cleanUrl, seed)) return;
    candidates.push({
      title: source,
      link: cleanUrl,
      source,
      acceptLanguage: getAcceptLanguage(cleanUrl, source),
      priority
    });
  }

  (seed.candidateUrls || [])
    .filter((url) => hasGermanCandidateMarker(url))
    .forEach((url) => push(url, "german-seed-official-candidate", 120));

  (seed.candidateUrls || [])
    .filter((url) => !hasGermanCandidateMarker(url))
    .forEach((url) => push(url, "english-seed-official-candidate", 110));

  (seed.germanStartUrls || []).forEach((url) => push(url, "german-start-url", 90));

  for (const domain of seed.officialDomains || []) {
    for (const path of DIRECT_PATHS_GERMAN) {
      push(`https://${domain}${path}`, "german-route-path", 80);
    }
  }

  (seed.englishStartUrls || []).forEach((url) => push(url, "english-start-url", 50));

  for (const domain of seed.officialDomains || []) {
    for (const path of DIRECT_PATHS_ENGLISH) {
      push(`https://${domain}${path}`, "english-route-path", 40);
    }
  }

  return candidates.sort((a, b) => b.priority - a.priority);
}

function formatLiveDiscoveryResult(seed, link, resultType, confidence, candidate, score, notes) {
  return {
    company: seed.company,
    title: `${seed.company} ${resultType.toLowerCase()}`,
    link,
    source: "live-official-site-discovery",
    confidence,
    verified: false,
    resultType,
    tier: confidence === "High" ? "Tier 1 candidate" : "Tier 2 candidate",
    language: candidate.source.includes("german") ? "German route checked first" : "English/global route",
    notes,
    instruction: resultType.includes("account") || resultType.includes("billing")
      ? "Sign in so the company can show your active subscription, then manage or cancel it from that page."
      : "Open the official page, sign in if asked, then follow the cancellation steps shown there.",
    score
  };
}

function hasDirectCancellationIntent(value) {
  return hasAny(value, [
    ...STRONG_GERMAN_TERMS,
    "cancel",
    "cancellation",
    "cancel subscription",
    "cancel a subscription",
    "cancel your subscription",
    "cancel subscriptions",
    "unsubscribe",
    "cancel membership",
    "end subscription",
    "terminate subscription",
    "close account",
    "delete account"
  ]);
}

function hasSubscriptionManagementIntent(value) {
  return hasAny(value, [
    "manage subscription",
    "manage subscriptions",
    "manage your subscription",
    "subscription management",
    "manage plan",
    "manage membership"
  ]);
}

function hasBillingSubscriptionLandingIntent(value) {
  return hasAny(value, [
    "billing",
    "subscription",
    "subscriptions",
    "membership",
    "memberships"
  ]);
}

function getRouteQualityRank(candidate, page) {
  const finalLink = page?.url || candidate?.link || "";
  const highSignalText = `${candidate?.title || ""} ${finalLink} ${page?.title || ""}`;
  const broadText = `${highSignalText} ${page?.text || ""}`;

  if (hasStrongExitWording(finalLink) || hasDirectCancellationIntent(highSignalText)) return 400;
  if (hasSubscriptionManagementIntent(highSignalText)) return 300;
  if (hasBillingSubscriptionLandingIntent(highSignalText) && hasDirectCancellationIntent(broadText)) return 200;
  if (hasSubscriptionManagementIntent(broadText) || hasDirectCancellationIntent(broadText)) return 100;

  return 0;
}

function rankRouteResults(results) {
  return [...results].sort((a, b) => (
    (b.routeQualityRank || 0) - (a.routeQualityRank || 0) ||
    (b.candidatePriority || 0) - (a.candidatePriority || 0) ||
    (b.score || 0) - (a.score || 0)
  ));
}

function scoreTrustedCandidateUrl(candidate, page, seed) {
  const finalLink = page?.url || candidate.link;
  const status = Number(page?.status || 0);

  if (!candidate.source.includes("seed-official-candidate")) return null;
  if (!finalLink || !isOfficialUrl(finalLink, seed)) return null;
  if (!hasStrongExitWording(finalLink)) return null;
  if (page && isSoft404Page(page)) return null;
  if (status && status >= 400 && !isBlockedStatus(status)) return null;

  const urlText = normaliseText(finalLink);
  const resultType =
    urlText.includes("billing") || urlText.includes("account") || urlText.includes("subscription")
      ? "Official account or billing route"
      : "Official cancellation route";

  const result = formatLiveDiscoveryResult(
    seed,
    finalLink,
    resultType,
    page && page.text && page.text.length > 120 ? "High" : "Medium",
    candidate,
    430,
    "Official candidate URL accepted from the company seed after official-domain and exit-word checks."
  );

  result.routeQualityRank = getRouteQualityRank(candidate, page);
  result.candidatePriority = candidate.priority || 0;
  return result;
}

function scoreCandidate(candidate, page, seed) {
  const finalLink = page?.url || candidate.link;
  const pageText = page?.text || "";
  const combinedText = `${candidate.title || ""} ${finalLink} ${page?.title || ""} ${pageText}`;

  if (!finalLink || !isOfficialUrl(finalLink, seed)) return null;
  if (page && page.status >= 400) return null;
  if (isSoft404Page(page)) return null;

  const scoredCandidate = {
    ...candidate,
    link: finalLink,
    title: page?.title || candidate.title || `${seed.company} official route`,
    pageText
  };

  if (isNegativeCandidate(scoredCandidate)) return null;
  if (isParkingPage({ ...page, expectedBrand: seed.company })) return null;

  const strongGerman = hasAny(combinedText, STRONG_GERMAN_TERMS);
  const strongEnglish = hasAny(combinedText, STRONG_ENGLISH_TERMS);
  const mediumRoute = hasAny(combinedText, MEDIUM_ROUTE_TERMS);
  const urlText = normaliseText(finalLink);
  const strongUrlIntent = hasStrongExitWording(finalLink);
  const hasStrongIntent = strongGerman || strongEnglish || strongUrlIntent;

  let score = 120;

  if (strongGerman) score += 260;
  if (strongEnglish) score += 220;
  if (mediumRoute) score += 90;

  if (urlText.includes("/cancel")) score += 220;
  if (urlText.includes("/unsubscribe")) score += 210;
  if (urlText.includes("/cancel-subscription")) score += 230;
  if (urlText.includes("/billing")) score += 120;
  if (urlText.includes("/account")) score += 120;
  if (urlText.includes("/subscription")) score += 120;
  if (urlText.includes("/kuendigung") || urlText.includes("/kundigung")) score += 260;
  if (urlText.includes("/abo-kuendigen")) score += 250;
  if (urlText.includes("/vertrag-kuendigen")) score += 250;
  if (urlText.includes("/mitgliedschaft-kuendigen")) score += 250;
  if (urlText.includes("help") || urlText.includes("support")) score += strongGerman || strongEnglish ? 35 : -25;
  if (urlText.includes("pricing") || urlText.includes("checkout") || urlText.includes("buy")) score -= 220;

  if (candidate.source.includes("german")) score += 35;
  if (candidate.source.includes("seed-official-candidate")) score += 45;
  if (pageText.includes("<form") || normaliseText(pageText).includes("form")) score += strongGerman || strongEnglish ? 40 : 0;

  if (!hasStrongIntent) return null;

  let confidence = "Low";
  if (score >= 520 && hasStrongIntent) confidence = "High";
  else if (score >= 300 && hasStrongIntent) confidence = "Medium";

  let resultType = "Official route";
  if (hasStrongIntent || urlText.includes("/cancel") || urlText.includes("kuendigung")) {
    resultType = "Official cancellation route";
  } else if (mediumRoute) {
    resultType = "Official account or billing route";
  }

  const result = formatLiveDiscoveryResult(
    seed,
    finalLink,
    resultType,
    confidence,
    candidate,
    score,
    "Official page found by Kickenut crawler. Needs manual verification before saving."
  );

  result.routeQualityRank = getRouteQualityRank(scoredCandidate, page);
  result.candidatePriority = candidate.priority || 0;
  return result;
}

function isStrongGermanResult(result, candidate) {
  if (!result || !isGermanCandidate(candidate)) return false;

  return (
    result.confidence === "High" ||
    result.resultType === "Official cancellation route" ||
    hasStrongExitWording(result.link)
  );
}

function shouldFollowLink(link) {
  const text = `${link.title || ""} ${link.link || ""}`;
  return looksLikeRoute({ ...link, pageText: "" });
}

async function discoverOfficialRoute(query, seed, options = {}) {
  const maxPages = options.maxPages || (options.deep ? 80 : DEFAULT_MAX_PAGES);
  const visited = new Set();
  const queue = buildInitialCandidates(seed);
  let remainingSeedCandidates = queue.filter((candidate) => candidate.source.includes("seed-official-candidate")).length;
  const seedResults = [];
  const inspected = [];
  const results = [];

  while (queue.length && inspected.length < maxPages) {
    if (!hasSearchBudget(options)) break;

    const candidate = queue.shift();
    const visitKey = candidate.link.replace(/[?#].*$/, "");

    if (visited.has(visitKey)) continue;
    visited.add(visitKey);

    if (!isOfficialUrl(candidate.link, seed)) continue;

    const candidateIsSeedUrl = candidate.source.includes("seed-official-candidate");
    let page = await fetchPage(candidate.link, {
      ...options,
      source: candidate.source,
      acceptLanguage: candidate.acceptLanguage,
      timeoutMs: candidate.source.includes("seed-official-candidate")
        ? Math.min(options.timeoutMs || DEFAULT_TIMEOUT_MS, DEFAULT_SEED_CANDIDATE_TIMEOUT_MS)
        : candidate.source.includes("start-url")
          ? Math.min(options.timeoutMs || DEFAULT_TIMEOUT_MS, DEFAULT_START_URL_TIMEOUT_MS)
          : candidate.source.includes("route-path")
            ? Math.min(options.timeoutMs || DEFAULT_TIMEOUT_MS, DEFAULT_ROUTE_PATH_TIMEOUT_MS)
            : options.timeoutMs
    });

    if (!page && candidateIsSeedUrl && hasSearchBudget(options, 100)) {
      page = await fetchPage(candidate.link, {
        ...options,
        source: `${candidate.source}-retry`,
        acceptLanguage: candidate.acceptLanguage,
        timeoutMs: Math.min(options.timeoutMs || DEFAULT_TIMEOUT_MS, DEFAULT_SEED_CANDIDATE_TIMEOUT_MS * 2)
      });
    }

    inspected.push(candidate.link);

    const trustedCandidate = scoreTrustedCandidateUrl(candidate, page, seed);
    if (trustedCandidate) {
      if (candidateIsSeedUrl) {
        seedResults.push(trustedCandidate);
      } else if (isStrongGermanResult(trustedCandidate, candidate)) {
        return trustedCandidate;
      } else {
        results.push(trustedCandidate);
      }
    }

    if (!page) {
      if (candidateIsSeedUrl) {
        remainingSeedCandidates -= 1;
        if (remainingSeedCandidates === 0 && seedResults.length) {
          return rankRouteResults(seedResults)[0];
        }
      }
      continue;
    }

    const scored = scoreCandidate(candidate, page, seed);
    if (scored) {
      if (candidateIsSeedUrl && scored.confidence !== "Low") {
        seedResults.push(scored);
      } else if (isStrongGermanResult(scored, candidate)) {
        return scored;
      } else {
        results.push(scored);
      }
    }

    if (candidateIsSeedUrl) {
      remainingSeedCandidates -= 1;
      if (remainingSeedCandidates === 0 && seedResults.length) {
        return rankRouteResults(seedResults)[0];
      }
    }

    for (const link of page.links || []) {
      if (!isOfficialUrl(link.link, seed)) continue;
      if (!shouldFollowLink(link)) continue;
      if (visited.has(link.link.replace(/[?#].*$/, ""))) continue;

      const linkIsGerman = isGermanCandidate({ title: link.title, link: link.link }) || isGermanCandidate(candidate);
      const source = linkIsGerman ? "german-official-page-link" : (link.source || "official-page-link");

      queue.push({
        title: link.title || "Official link",
        link: link.link,
        source,
        acceptLanguage: getAcceptLanguage(link.link, source),
        priority: linkIsGerman ? 70 : 30
      });
    }

    queue.sort((a, b) => b.priority - a.priority);
  }

  const rankedResults = results
    .filter((result) => result.confidence !== "Low" || result.score >= 220)
    .sort((a, b) => (
      (b.routeQualityRank || 0) - (a.routeQualityRank || 0) ||
      (b.candidatePriority || 0) - (a.candidatePriority || 0) ||
      (b.score || 0) - (a.score || 0)
    ));

  return rankedResults[0] || null;
}

async function searchCancellationRoute(query, options = {}) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) {
    return {
      error: "No query provided",
      searched: false
    };
  }

  const verified = getVerifiedResult(cleanQuery);
  if (verified) return verified;

  const searchOptions = {
    ...options,
    deadlineMs: options.deadlineMs || Date.now() + (
      options.deep ? DEFAULT_DEEP_SEARCH_TIME_BUDGET_MS : DEFAULT_SEARCH_TIME_BUDGET_MS
    )
  };

  const seed = getCompanySeed(cleanQuery) || await discoverCompanySeed(cleanQuery, searchOptions);
  if (!seed) return formatNoResult(cleanQuery);

  const discovered = await discoverOfficialRoute(cleanQuery, seed, searchOptions);
  return discovered || formatNoResult(cleanQuery, seed);
}

module.exports = {
  searchCancellationRoute,
  getVerifiedResult,
  getCompanySeed,
  discoverCompanySeed,
  discoverOfficialRoute,
  deriveOfficialSiteUrl,
  normaliseKey
};
