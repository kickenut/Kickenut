const path = require("path");
const verifiedResults = require("./data/verifiedResults");
const { readJsonFile, writeJsonFileAtomic } = require("./jsonStorage");

const DEFAULT_REVIEW_CANDIDATES_FILE = path.join(__dirname, "data", "reviewCandidates.json");
const DEFAULT_REVIEW_CANDIDATES_MAX_ENTRIES = 500;

const TRACKING_QUERY_KEYS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_",
  "referrer",
  "source",
  "spm"
]);

const RELEVANT_TERMS = [
  "account",
  "abo",
  "billing",
  "cancel",
  "cancellation",
  "close account",
  "delete account",
  "end subscription",
  "kuendigen",
  "kuendigung",
  "kundigen",
  "kundigung",
  "manage",
  "membership",
  "subscription",
  "terminate subscription",
  "unsubscribe",
  "vertrag"
];

const WEAK_OR_UNSAFE_TERMS = [
  "affiliate",
  "blog",
  "community",
  "facebook",
  "forum",
  "forums",
  "generic support",
  "help homepage",
  "instagram",
  "pricing",
  "quora",
  "reddit",
  "start free trial",
  "support homepage",
  "tiktok",
  "youtube.com/watch"
];

function normaliseText(value) {
  return String(value || "").toLowerCase();
}

function canonicalReviewUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol)) return "";

    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";

    for (const key of [...url.searchParams.keys()]) {
      const cleanKey = key.toLowerCase();
      if (cleanKey.startsWith("utm_") || TRACKING_QUERY_KEYS.has(cleanKey)) {
        url.searchParams.delete(key);
      }
    }

    url.searchParams.sort();
    return url.href;
  } catch {
    return "";
  }
}

function readReviewCandidates(filePath = DEFAULT_REVIEW_CANDIDATES_FILE) {
  return readJsonFile(filePath, [], {
    validate: Array.isArray
  });
}

function getReviewCandidatesMaxEntries(options = {}) {
  const value = Number(options.maxEntries || process.env.KICKENUT_REVIEW_CANDIDATES_MAX_ENTRIES || DEFAULT_REVIEW_CANDIDATES_MAX_ENTRIES);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_REVIEW_CANDIDATES_MAX_ENTRIES;
}

function pruneReviewCandidates(candidates, options = {}) {
  return [...(Array.isArray(candidates) ? candidates : [])]
    .sort((a, b) => Date.parse(b.lastSeen || b.firstFound || 0) - Date.parse(a.lastSeen || a.firstFound || 0))
    .slice(0, getReviewCandidatesMaxEntries(options));
}

function writeReviewCandidates(candidates, filePath = DEFAULT_REVIEW_CANDIDATES_FILE, options = {}) {
  writeJsonFileAtomic(filePath, pruneReviewCandidates(candidates, options));
}

function isVerifiedUrl(value) {
  const canonical = canonicalReviewUrl(value);
  if (!canonical) return false;

  return verifiedResults.some((result) => canonicalReviewUrl(result.url) === canonical);
}

function isGoodReviewCandidate(result) {
  if (!result || !result.link) return false;
  if (result.verified || result.source === "verified") return false;
  if (isVerifiedUrl(result.link)) return false;

  const text = normaliseText([
    result.title,
    result.link,
    result.resultType,
    result.source,
    result.notes,
    result.instruction
  ].filter(Boolean).join(" "));

  if (!RELEVANT_TERMS.some((term) => text.includes(term))) return false;
  if (WEAK_OR_UNSAFE_TERMS.some((term) => text.includes(term))) return false;

  return true;
}

function buildReviewCandidate(query, result, officialSite, now) {
  const canonicalUrl = canonicalReviewUrl(result.link);

  return {
    searchedQuery: String(query || "").trim(),
    company: result.company || "",
    title: result.title || "",
    url: result.link,
    canonicalUrl,
    officialSite: officialSite || result.officialSite || "",
    resultType: result.resultType || "Official route",
    source: result.source || "",
    confidence: result.confidence || "",
    tier: result.tier || "",
    score: Number.isFinite(result.score) ? result.score : null,
    reason: result.notes || "Kickenut returned this non-verified official route as a good review candidate.",
    firstFound: now,
    lastSeen: now,
    timesSeen: 1,
    status: "pending_review"
  };
}

function recordReviewCandidate(query, result, options = {}) {
  if (!isGoodReviewCandidate(result)) return null;

  const filePath = options.filePath || process.env.KICKENUT_REVIEW_FILE || DEFAULT_REVIEW_CANDIDATES_FILE;
  const now = options.now || new Date().toISOString();
  const canonicalUrl = canonicalReviewUrl(result.link);

  if (!canonicalUrl) return null;

  try {
    const candidates = readReviewCandidates(filePath);
    const existing = candidates.find((candidate) => candidate.canonicalUrl === canonicalUrl);

    if (existing) {
      existing.lastSeen = now;
      existing.timesSeen = Number(existing.timesSeen || 1) + 1;
      if (!existing.officialSite && (options.officialSite || result.officialSite)) {
        existing.officialSite = options.officialSite || result.officialSite;
      }
      writeReviewCandidates(candidates, filePath, options);
      return existing;
    }

    const candidate = buildReviewCandidate(query, result, options.officialSite, now);
    candidates.push(candidate);
    writeReviewCandidates(candidates, filePath, options);
    return candidate;
  } catch (err) {
    console.error("Could not save review candidate:", err.message);
    return null;
  }
}

module.exports = {
  DEFAULT_REVIEW_CANDIDATES_FILE,
  DEFAULT_REVIEW_CANDIDATES_MAX_ENTRIES,
  canonicalReviewUrl,
  isGoodReviewCandidate,
  pruneReviewCandidates,
  readReviewCandidates,
  recordReviewCandidate,
  writeReviewCandidates
};
