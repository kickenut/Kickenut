const express = require("express");
const cors = require("cors");

const API_KEY = process.env.SERPAPI_KEY;

const app = express();

app.use(cors());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

const strongExitWords = [
  "cancel",
  "cancellation",
  "unsubscribe",
  "subscription",
  "subscriptions",
  "manage subscription",
  "billing",
  "account",
  "premium",
  "plan",
  "membership"
];

const directPageWords = [
  "cancel",
  "unsubscribe",
  "subscription",
  "subscriptions",
  "billing",
  "account",
  "manage",
  "premium",
  "plan",
  "membership"
];

const badThirdPartyWords = [
  "reddit",
  "quora",
  "wikihow",
  "medium",
  "forum",
  "blog",
  "reviews",
  "trustpilot"
];

const badOfficialWords = [
  "community",
  "discussion",
  "boards",
  "forum"
];

const badAppStoreWords = [
  "apps.apple.com",
  "play.google.com",
  "app store",
  "google play",
  "download app",
  "get app",
  "install app"
];

function cleanQuery(query) {
  return query.trim().replace(/[^\w\s.-]/g, "");
}

function getLikelyDomain(company) {
  return (
    company
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9]/g, "") + ".com"
  );
}

async function serpSearch(searchQuery) {
  const url =
    `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(searchQuery)}&api_key=${API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  return data.organic_results || [];
}

function scoreResult(result, likelyDomain) {
  const title = (result.title || "").toLowerCase();
  const link = (result.link || "").toLowerCase();
  const snippet = (result.snippet || "").toLowerCase();

  const combined = `${title} ${link} ${snippet}`;

  let score = 0;

  const isOfficial = link.includes(likelyDomain);

  if (isOfficial) {
    score += 300;
  } else {
    score -= 500;
  }

  strongExitWords.forEach((word) => {
    if (combined.includes(word)) {
      score += 40;
    }
  });

  directPageWords.forEach((word) => {
    if (link.includes(word)) {
      score += 90;
    }
  });

  badThirdPartyWords.forEach((word) => {
    if (combined.includes(word)) {
      score -= 350;
    }
  });

  badOfficialWords.forEach((word) => {
    if (combined.includes(word)) {
      score -= 280;
    }
  });

  badAppStoreWords.forEach((word) => {
    if (combined.includes(word)) {
      score -= 500;
    }
  });

  if (
    link.includes("/cancel") ||
    link.includes("cancel") ||
    link.includes("unsubscribe")
  ) {
    score += 300;
  }

  if (
    link.includes("/account") ||
    link.includes("/billing") ||
    link.includes("/subscription") ||
    link.includes("/subscriptions") ||
    link.includes("/manage")
  ) {
    score += 180;
  }

  if (
    link.includes("support.apple.com") ||
    link.includes("account.apple.com") ||
    link.includes("billing.apple.com") ||
    link.includes("subscriptions.apple.com")
  ) {
    score += 250;
  }

  if (
    link.includes("community.") ||
    link.includes("/community") ||
    link.includes("/forum") ||
    link.includes("discussion")
  ) {
    score -= 450;
  }

  if (
    link.includes("apps.apple.com") &&
    !link.includes("/account/subscriptions")
  ) {
    score -= 700;
  }

  return score;
}

function getBestResult(results, likelyDomain) {
  if (!results.length) return null;

  const scored = results.map((result) => ({
    ...result,
    score: scoreResult(result, likelyDomain)
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored[0];
}

async function performSearches(searches, likelyDomain) {
  let bestOverall = null;

  for (const query of searches) {
    const results = await serpSearch(query);
    const best = getBestResult(results, likelyDomain);

    if (!best) continue;

    if (!bestOverall || best.score > bestOverall.score) {
      bestOverall = best;
    }
  }

  return bestOverall;
}

app.get("/search", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.json({
        error: "Missing SerpAPI key."
      });
    }

    const query = cleanQuery(req.query.q || "");
    const isDeepSearch = req.query.deep === "true";

    if (!query) {
      return res.json({
        error: "No search query provided."
      });
    }

    const lowerQuery = query.toLowerCase();
    const likelyDomain = getLikelyDomain(query);

    if (lowerQuery === "spotify") {
      return res.json({
        title: "Spotify Premium Subscription",
        link: "https://www.spotify.com/account/subscription/",
        snippet: "Official Spotify subscription management page."
      });
    }

    if (lowerQuery === "apple" || lowerQuery === "apple subscriptions") {
      return res.json({
        title: "Apple subscriptions and billing support",
        link: "https://support.apple.com/en-us/118428",
        snippet: "Official Apple page for cancelling subscriptions."
      });
    }

    const normalSearches = [
      `site:${likelyDomain} cancel subscription`,
      `site:${likelyDomain} unsubscribe billing account`,
      `site:${likelyDomain} manage subscription`,
      `site:${likelyDomain} billing account`
    ];

    const deepSearches = [
      `site:${likelyDomain} cancel subscription manage account`,
      `site:${likelyDomain} premium cancel plan`,
      `site:${likelyDomain} billing manage subscription`,
      `site:${likelyDomain} support unsubscribe account`,
      `site:${likelyDomain} help cancel premium`
    ];

    const normalBest = await performSearches(
      normalSearches,
      likelyDomain
    );

    let finalBest = normalBest;

    if (isDeepSearch) {
      const deepBest = await performSearches(
        deepSearches,
        likelyDomain
      );

      if (
        deepBest &&
        normalBest &&
        deepBest.score > normalBest.score
      ) {
        finalBest = deepBest;
      }
    }

    if (!finalBest) {
      return res.json({
        title: `Search Google for ${query} cancellation`,
        link: `https://www.google.com/search?q=${encodeURIComponent(
          `official cancel ${query} subscription`
        )}`,
        snippet:
          "Kickenut could not confidently find an official cancellation page."
      });
    }

    res.json({
      title: finalBest.title,
      link: finalBest.link,
      snippet:
        finalBest.snippet ||
        "Official cancellation or subscription page found."
    });

  } catch (error) {
    console.error(error);

    res.json({
      error: "Something went wrong while searching."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
