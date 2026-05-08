const express = require("express");
const cors = require("cors");

const API_KEY = process.env.SERPAPI_KEY;

const app = express();
app.use(cors());
app.use(express.static(__dirname));

const PORT = 3000;

const strongExitWords = [
  "cancel",
  "cancellation",
  "unsubscribe",
  "stop subscription",
  "close account",
  "delete account",
  "deactivate",
  "terminate",
  "opt out"
];

const directUrlWords = [
  "cancel",
  "cancellation",
  "unsubscribe",
  "subscription",
  "subscriptions",
  "billing",
  "account",
  "membership",
  "plan"
];

const weakSupportWords = [
  "support",
  "help",
  "article",
  "guide",
  "faq"
];

const badThirdPartyWords = [
  "wikihow",
  "reddit",
  "quora",
  "blog",
  "forum",
  "medium",
  "trustpilot",
  "complaints",
  "reviews"
];

function cleanQuery(query) {
  return query.trim().replace(/[^\w\s.-]/g, "");
}

function getLikelyDomain(company) {
  const cleaned = company
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");

  return `${cleaned}.com`;
}

async function serpSearch(searchQuery) {
  const url =
    `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(searchQuery)}&api_key=${API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  return data.organic_results || [];
}

function scoreResult(result, company, likelyDomain, layer) {
  const title = (result.title || "").toLowerCase();
  const link = (result.link || "").toLowerCase();
  const snippet = (result.snippet || "").toLowerCase();
  const combined = `${title} ${link} ${snippet}`;

  let score = 0;

  const isOfficial = link.includes(likelyDomain);

  if (isOfficial) score += 150;
  if (!isOfficial) score -= 120;

  directUrlWords.forEach((word) => {
    if (link.includes(word)) score += 60;
  });

  strongExitWords.forEach((word) => {
    if (combined.includes(word)) score += 35;
  });

  weakSupportWords.forEach((word) => {
    if (link.includes(word)) score += 10;
  });

  if (link.includes("/support") || link.includes("support.")) {
    score += 15;
  }

  if (link.includes("/help") || link.includes("help.")) {
    score += 10;
  }

  if (
    link.includes("/cancel") ||
    link.includes("cancel") ||
    link.includes("unsubscribe") ||
    link.includes("subscription") ||
    link.includes("billing")
  ) {
    score += 100;
  }

  badThirdPartyWords.forEach((word) => {
    if (combined.includes(word)) score -= 100;
  });

  if (layer === 1) score += 120;
  if (layer === 2) score += 70;
  if (layer === 3) score += 30;
  if (layer === 4) score -= 40;

  return score;
}

function pickBestResult(results, company, likelyDomain, layer) {
  if (!results.length) return null;

  const scored = results.map((result) => ({
    ...result,
    score: scoreResult(result, company, likelyDomain, layer)
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored[0];
}

app.get("/search", async (req, res) => {
  try {
    const query = cleanQuery(req.query.q || "");

    if (!query) {
      return res.json({
        error: "No search query provided"
      });
    }

    const likelyDomain = getLikelyDomain(query);

    const searches = [
      {
        layer: 1,
        q: `site:${likelyDomain} cancel subscription`
      },
      {
        layer: 1,
        q: `site:${likelyDomain} unsubscribe billing account`
      },
      {
        layer: 2,
        q: `site:${likelyDomain} support cancel subscription billing account`
      },
      {
        layer: 3,
        q: `${query} official cancel subscription billing account`
      },
      {
        layer: 4,
        q: `how to cancel ${query} subscription`
      }
    ];

    let bestResult = null;

if (query.toLowerCase() === "spotify") {
  return res.json({
    title: "Spotify Premium Cancellation",
    link: "https://www.spotify.com/account/subscription/",
    snippet: "Official Spotify subscription management page."
  });
}

    for (const search of searches) {
      const results = await serpSearch(search.q);
      const picked = pickBestResult(results, query, likelyDomain, search.layer);

      if (picked && picked.score > 80) {
        bestResult = picked;
        break;
      }
    }

    if (!bestResult) {
      return res.json({
        title: `Search Google for ${query} cancellation`,
        link: `https://www.google.com/search?q=${encodeURIComponent(
          `official cancel ${query} subscription`
        )}`,
        snippet: `Kickenut could not confidently find an official cancellation page, so this opens a Google search for the official cancellation page.`
      });
    }

    res.json({
      title: bestResult.title,
      link: bestResult.link,
      snippet:
        bestResult.snippet ||
        "Official cancellation, billing, account, or subscription page found.",
      steps: [
        "Open the official company page.",
        "Log in only on the official website.",
        "Look for cancel, subscription, billing, account, or membership settings.",
        "Follow the company’s cancellation instructions."
      ],
      tips: [
        "Never enter your password into Kickenut.",
        "Only enter login details on the official company website.",
        "Check whether the subscription remains active until the end of the billing period."
      ]
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
