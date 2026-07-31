const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  searchCancellationRoute,
  getVerifiedResult,
  getCompanySeed,
  discoverCompanySeed,
  discoverOfficialRoute,
  deriveOfficialSiteUrl,
  normaliseKey
} = require("./searchEngine");
const {
  canonicalReviewUrl,
  readReviewCandidates,
  recordReviewCandidate
} = require("./reviewQueue");
const {
  readVerifiedHealth,
  runVerifiedHealthCheck
} = require("./verifiedHealth");

const root = __dirname;
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const searchEngine = fs.readFileSync(path.join(root, "searchEngine.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const searchHtml = fs.readFileSync(path.join(root, "search.html"), "utf8");
const packageJson = fs.readFileSync(path.join(root, "package.json"), "utf8");
const removedWorkerPath = path.join(root, "kickenut-browser-search.js");

const fetchCalls = [];

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html"
    }
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function healthHtmlResponse(html, status = 200, finalUrl = "") {
  return {
    status,
    url: finalUrl,
    headers: {
      get: () => "text/html"
    },
    text: async () => html
  };
}

function wikidataEntity(websiteUrl) {
  return {
    entities: {
      QFIGMA: {
        labels: {
          en: {
            value: "Figma"
          }
        },
        descriptions: {
          en: {
            value: "collaborative design software company"
          }
        },
        claims: {
          P856: [
            {
              mainsnak: {
                datavalue: {
                  value: websiteUrl
                }
              }
            }
          ]
        }
      }
    }
  };
}

async function fakeOfficialFetch(url) {
  const urlText = String(url);
  fetchCalls.push(urlText);

  if (urlText.includes("wikidata.org/w/api.php")) {
    const search = new URL(urlText).searchParams.get("search") || "";

    if (search === "Figma") {
      return jsonResponse({
        search: [
          {
            id: "QFIGMA",
            label: "Figma",
            description: "collaborative design software company"
          }
        ]
      });
    }

    return jsonResponse({
      search: []
    });
  }

  if (urlText.includes("Special:EntityData/QFIGMA.json")) {
    return jsonResponse(wikidataEntity("https://www.figma.com/"));
  }

  if (urlText === "https://www.canva.com/help/cancel-canva-plan/") {
    throw new Error("Simulated crawler block for seeded official candidate URL.");
  }

  if (urlText === "https://support.apple.com/en-us/118428") {
    return htmlResponse(
      `<!doctype html>
      <html>
        <head><title>If you want to cancel a subscription from Apple - Apple Support</title></head>
        <body>
          <main>
            <h1>If you want to cancel a subscription from Apple</h1>
            <p>Learn how to cancel a subscription from Apple and manage subscriptions on this official Apple Support page.</p>
          </main>
        </body>
      </html>`
    );
  }

  if (urlText === "https://support.apple.com/billing") {
    return htmlResponse(
      `<!doctype html>
      <html>
        <head><title>Apple billing and subscriptions support</title></head>
        <body>
          <main>
            <h1>Billing and subscriptions</h1>
            <p>Use official Apple support to manage subscriptions, cancel a subscription, and review billing.</p>
          </main>
        </body>
      </html>`
    );
  }

  if (urlText === "https://ranktest.com/billing") {
    return htmlResponse(
      `<!doctype html>
      <html>
        <head><title>Billing and subscriptions</title></head>
        <body>
          <main>
            <h1>Billing and subscriptions</h1>
            <p>Manage subscriptions, cancel a subscription, and review billing.</p>
          </main>
        </body>
      </html>`
    );
  }

  if (urlText === "https://ranktest.com/cancel") {
    return htmlResponse(
      `<!doctype html>
      <html>
        <head><title>Cancel subscription</title></head>
        <body>
          <main>
            <h1>Cancel subscription</h1>
            <p>Direct official cancellation page to cancel a subscription.</p>
          </main>
        </body>
      </html>`
    );
  }

  if (urlText === "https://help.stan.com.au/hc/en-us/articles/202759790-How-do-I-cancel-my-Stan-account") {
    return htmlResponse(
      `<!doctype html>
      <html>
        <head><title>How do I cancel my Stan account?</title></head>
        <body>
          <main>
            <h1>How do I cancel my Stan account?</h1>
            <p>This official Stan help article explains how to cancel your subscription and manage your membership.</p>
          </main>
        </body>
      </html>`
    );
  }

  if (urlText === "https://support.google.com/googleplay/workflow/9827184?hl=en") {
    return htmlResponse(
      `<!doctype html>
      <html>
        <head><title>Cancel, pause, or change a subscription on Google Play</title></head>
        <body>
          <main>
            <h1>Cancel, pause, or change a subscription</h1>
            <p>This official Google Play support workflow helps customers cancel subscriptions and manage billing.</p>
          </main>
        </body>
      </html>`
    );
  }

  if (urlText === "https://support.google.com/googleplay/answer/7018481?hl=en") {
    return htmlResponse(
      `<!doctype html>
      <html>
        <head><title>Manage subscriptions on Google Play</title></head>
        <body><main><p>Official Google Play help for subscription management and cancellation.</p></main></body>
      </html>`
    );
  }

  if (urlText === "https://www.figma.com/" || urlText === "https://figma.com/") {
    return htmlResponse(
      `<!doctype html>
      <html>
        <head><title>Figma - collaborative design platform</title></head>
        <body>
          <main>
            <h1>Figma</h1>
            <p>Figma is a collaborative design software platform.</p>
            <a href="/cancel">Cancel subscription</a>
          </main>
        </body>
      </html>`
    );
  }

  if (urlText === "https://figma.com/cancel") {
    return htmlResponse(
      `<!doctype html>
      <html>
        <head><title>Cancel Figma subscription</title></head>
        <body>
          <main>
            <h1>Cancel subscription</h1>
            <p>Use this official Figma page to cancel, manage subscription billing, or end a membership.</p>
          </main>
        </body>
      </html>`
    );
  }

  if (urlText === "https://launchwidget.com/") {
    return htmlResponse(
      `<!doctype html>
      <html>
        <head><title>Launch Widget</title></head>
        <body><main><h1>Launch Widget</h1><p>Launch Widget customer platform.</p></main></body>
      </html>`
    );
  }

  if (urlText === "https://www.dropbox.com/" || urlText === "https://help.dropbox.com/") {
    return htmlResponse(
      `<!doctype html>
      <html>
        <head><title>Dropbox</title></head>
        <body><main><h1>Dropbox</h1><p>Official Dropbox website and help center.</p></main></body>
      </html>`
    );
  }

  if (urlText === "https://www.hellofresh.com/about/how-to-cancel-hellofresh-subscription") {
    return htmlResponse(
      `<!doctype html>
      <html>
        <head><title>How to cancel HelloFresh subscription</title></head>
        <body>
          <main>
            <h1>How to cancel HelloFresh subscription</h1>
            <p>This official HelloFresh page explains how to cancel, manage a plan, and end a membership.</p>
          </main>
        </body>
      </html>`
    );
  }

  if (urlText === "https://germanseed.de/kuendigung") {
    return htmlResponse(
      `<!doctype html>
      <html>
        <head><title>German Seed Kuendigung</title></head>
        <body>
          <main>
            <h1>Abo kuendigen</h1>
            <p>Offizielle Seite, um das Abo zu kuendigen, den Vertrag zu beenden und die Mitgliedschaft zu kuendigen.</p>
          </main>
        </body>
      </html>`
    );
  }

  if (urlText === "https://germanseed.com/cancel-subscription") {
    return htmlResponse(
      `<!doctype html>
      <html>
        <head><title>German Seed cancel subscription</title></head>
        <body><main><p>Official English cancellation page to cancel subscription and manage billing.</p></main></body>
      </html>`
    );
  }

  if (urlText === "https://germanfirst.de/kuendigung") {
    return htmlResponse(
      `<!doctype html>
      <html>
        <head><title>German First Kuendigung</title></head>
        <body>
          <main>
            <h1>Vertrag kuendigen</h1>
            <p>Offizielle Seite fuer Kuendigung, Abo kuendigen und Mitgliedschaft kuendigen.</p>
          </main>
        </body>
      </html>`
    );
  }

  if (urlText === "https://germanfirst.com/cancel-subscription") {
    return htmlResponse(
      `<!doctype html>
      <html>
        <head><title>German First cancel subscription</title></head>
        <body><main><p>Official English cancellation page to cancel subscription and manage billing.</p></main></body>
      </html>`
    );
  }

  if (urlText === "https://www.sky.de/online-kuendigung") {
    return htmlResponse(
      `<!doctype html>
      <html>
        <head><title>Sky Online-Kuendigung</title></head>
        <body>
          <main>
            <h1>Sky online kuendigen</h1>
            <p>Offizielle Sky Seite fuer Kuendigung, Vertrag kuendigen, Abo kuendigen und Mitgliedschaft beenden.</p>
          </main>
        </body>
      </html>`
    );
  }

  if (urlText === "https://routestack.com/cancel?ref=nav") {
    return htmlResponse(
      `<!doctype html>
      <html>
        <head><title>Cancel Route Stack</title></head>
        <body><main><h1>Cancel subscription</h1><p>Official Route Stack page to cancel subscription and manage billing.</p></main></body>
      </html>`
    );
  }

  if (urlText === "https://routestack.com/cancel-alt") {
    return htmlResponse(
      `<!doctype html>
      <html>
        <head><title>Alternative Route Stack cancellation</title></head>
        <body><main><h1>Cancel membership</h1><p>Official alternative cancellation route to unsubscribe and end a membership.</p></main></body>
      </html>`
    );
  }

  if (urlText === "https://routestack.com/account") {
    return htmlResponse(
      `<!doctype html>
      <html>
        <head><title>Route Stack account</title></head>
        <body><main><h1>Account</h1><p>Sign in to your account to manage your subscription and billing.</p></main></body>
      </html>`
    );
  }

  if (urlText === "https://marketonly.com/" || urlText === "https://marketonly.com/help") {
    return htmlResponse(
      `<!doctype html>
      <html>
        <head><title>Market Only help</title></head>
        <body><main><h1>Help homepage</h1><p>Generic support and marketing content.</p></main></body>
      </html>`
    );
  }

  return htmlResponse("<html><title>Not found</title><body>Not found</body></html>", 404);
}

function assertVerified(query, expectedCompany, expectedLinkPart) {
  const result = getVerifiedResult(query);
  assert(result, `${query} should return from verified results.`);
  assert.strictEqual(result.company, expectedCompany);
  assert.strictEqual(result.verified, true);
  assert.strictEqual(result.source, "verified");
  assert(result.link.includes(expectedLinkPart), `${query} should link to ${expectedLinkPart}.`);
}

function makeLiveReviewResult(overrides = {}) {
  return {
    company: "Apple",
    title: "Apple official cancellation route",
    link: "https://support.apple.com/en-us/118428",
    source: "live-official-site-discovery",
    confidence: "High",
    verified: false,
    resultType: "Official cancellation route",
    tier: "Tier 1 candidate",
    notes: "Official page found by Kickenut crawler. Needs manual verification before saving.",
    instruction: "Open the official page, sign in if asked, then follow the cancellation steps shown there.",
    score: 675,
    ...overrides
  };
}

async function fakeVerifiedHealthFetch(url) {
  const urlText = String(url);

  if (urlText === "https://healthy.example/cancel") {
    return healthHtmlResponse(
      "<html><head><title>Cancel subscription</title></head><body>Cancel your subscription and manage billing.</body></html>",
      200,
      urlText
    );
  }

  if (urlText === "https://broken.example/cancel") {
    return healthHtmlResponse("<html><title>Not found</title><body>Not found</body></html>", 404, urlText);
  }

  if (urlText === "https://gone.example/cancel") {
    return healthHtmlResponse("<html><title>Gone</title><body>Gone</body></html>", 410, urlText);
  }

  if (urlText === "https://server.example/cancel") {
    return healthHtmlResponse("<html><title>Server error</title><body>Error</body></html>", 500, urlText);
  }

  if (urlText === "https://timeout.example/cancel") {
    const err = new Error("Timed out");
    err.name = "AbortError";
    throw err;
  }

  if (urlText === "https://soft.example/cancel") {
    return healthHtmlResponse(
      "<html><head><title>Page not found</title></head><body>We can't find that page.</body></html>",
      200,
      urlText
    );
  }

  if (urlText === "https://parked.example/cancel") {
    return healthHtmlResponse(
      "<html><head><title>Domain for sale</title></head><body>Buy this domain today.</body></html>",
      200,
      urlText
    );
  }

  if (urlText === "https://redirect.example/cancel") {
    return healthHtmlResponse(
      "<html><head><title>Redirect Example</title></head><body>Welcome to our homepage.</body></html>",
      200,
      "https://redirect.example/"
    );
  }

  if (urlText === "https://mismatch.example/cancel") {
    return healthHtmlResponse(
      "<html><head><title>Cancel subscription</title></head><body>Cancel subscription.</body></html>",
      200,
      "https://unrelated.example/cancel"
    );
  }

  if (urlText === "https://generic.example/help") {
    return healthHtmlResponse(
      "<html><head><title>Help Center</title></head><body>Generic support homepage.</body></html>",
      200,
      urlText
    );
  }

  if (urlText === "https://login.example/account") {
    return healthHtmlResponse(
      "<html><head><title>Sign in</title></head><body>Sign in to manage your account and subscriptions.</body></html>",
      403,
      urlText
    );
  }

  if (urlText === "https://recover.example/cancel") {
    return healthHtmlResponse(
      "<html><head><title>Cancel membership</title></head><body>Cancel membership and manage subscriptions.</body></html>",
      200,
      urlText
    );
  }

  return healthHtmlResponse("<html><title>Not found</title><body>Not found</body></html>", 404, urlText);
}

(async () => {
  const paidSearchName = ["serp", "api"].join("");
  const paidSearchKey = ["SERP", "API", "_KEY"].join("");
  const browserWorkerName = ["kickenut", "browser", "search"].join("-");

  assert(!fs.existsSync(removedWorkerPath), "Removed browser-search worker must not exist.");
  assert(!server.includes(paidSearchName.toUpperCase()), "Server must not depend on paid search.");
  assert(!server.includes(paidSearchKey), "Server must not require a paid search key.");
  assert(!server.includes(`require("./${browserWorkerName}")`), "Server must not load the removed browser-search worker.");
  assert(!server.includes("discoverWithBrowserWorker"), "Server must not call the removed browser-search worker.");
  assert(server.includes("officialSite"), "Server responses must include the official-site convenience URL.");
  assert(server.includes("result.officialSite || deriveOfficialSiteUrl"), "Server must preserve no-result official-site fallbacks.");
  assert(server.includes("canonicalResultTarget(officialSite) === canonicalResultTarget(result.link)"), "Server must not return an officialSite that equals the search result.");
  assert(!server.includes("allowExclusions"), "Server must not keep Try Another Route exclusion handling.");
  assert(!server.includes("finalFallbackOnly"), "Server must not keep alternative-route final fallback handling.");
  assert(!server.includes("/deep-search"), "Deep Search endpoint must not remain active.");
  assert(!searchEngine.toLowerCase().includes(`${paidSearchName}.com`), "Search engine must not call paid search.");
  assert(!searchEngine.includes(["google.com", "search"].join("/")), "Search engine must not scrape search result pages.");
  assert(searchEngine.includes("deriveOfficialSiteUrl"), "Search engine must derive official-site URLs from successful result URLs.");
  assert(!searchEngine.includes("normaliseComparableUrl"), "Search engine must not keep alternative-route URL exclusion comparison.");
  assert(!searchEngine.includes("finalFallbackOnly"), "Search engine must not keep alternative-route discovery mode.");
  assert(packageJson.includes("\"health:verified\": \"node run-verified-health-check.js\""), "Package must include the manual verified URL health-check script.");
  assert(fs.existsSync(path.join(root, "verifiedHealth.js")), "Internal verified URL health checker must exist.");
  assert(fs.existsSync(path.join(root, "run-verified-health-check.js")), "Manual verified URL health-check runner must exist.");
  assert(fs.existsSync(path.join(root, "data", "verifiedHealth.json")), "Verified URL health report file must exist.");

  for (const html of [indexHtml, searchHtml]) {
    assert(html.includes("<button class=\"kickenut-action-button\" onclick=\"searchSubscription()\">"), "Search button markup must remain in place.");
    assert(html.includes("Official Website"), "Frontend must show the official-site convenience button.");
    assert(!html.includes("OFFICIAL WEBSITE"), "Frontend must not use uppercase Official Website wording.");
    assert(html.includes("font-size: 18px"), "Official-site button font size must match the Search button.");
    assert(html.includes("official-website-inactive"), "Official Website must start grey/inactive before search.");
    assert(html.includes("official-website-active"), "Official Website must have an active yellow state.");
    assert(html.includes("officialSiteButton.disabled = true"), "Official Website must be disabled while inactive.");
    assert(html.includes("officialSiteButton.disabled = false"), "Official Website must be enabled when active.");
    assert(html.includes("if (data.officialSite)"), "No-result responses with a safe officialSite must activate the button.");
    assert(html.includes("activateOfficialSiteButton(query);"), "Known no-result official sites must activate immediately.");
    assert(html.includes("window.open(storedOfficialSiteUrl, \"_blank\", \"noopener,noreferrer\")"), "Official Website must open only from a click in a new tab.");
    assert(html.includes("target=\"_blank\""), "Open official result must open in a new tab.");
    assert(html.includes("activateOfficialSiteButton(lastSearch);"), "Successful result flow must still activate after return.");
    assert(html.includes("openOfficialSite()"), "Official-site button must open the derived official site.");
    assert(html.includes("kickenutOfficialSiteUrl"), "Frontend must remember the official site only for the current return flow.");
    assert(!html.includes("function deriveOfficialSiteUrl"), "Frontend must use the backend officialSite value instead of deriving a homepage.");
    assert(!html.includes("Try Another Route"), "Frontend must not show Try Another Route.");
    assert(!/>\s*Deep Search\s*</.test(html), "Frontend must not show the old Deep Search button text.");
    assert(!html.includes("MAX_ALTERNATIVE_ATTEMPTS"), "Frontend must not keep alternative-attempt limits.");
    assert(!html.includes("excludeUrls"), "Frontend must not send exclusion lists.");
    assert(!html.includes("tryAnotherRoute"), "Frontend must not keep Try Another Route behavior.");
    assert(html.includes("activeSearchRequestId"), "Frontend must track the latest active request id.");
    assert(html.includes("new AbortController()"), "Frontend must create AbortController for each search.");
    assert(html.includes("activeSearchController.abort()"), "Frontend must abort the previous active search.");
    assert(html.includes("signal: controller.signal"), "Fetch must receive the current AbortController signal.");
    assert(html.includes("isCurrentSearch(requestId, query)"), "Late responses must be checked against the latest request.");
    assert(html.includes("showManualResultLink(data.link"), "The result button is only rendered after a current valid result.");

    const successBranch = html.match(/if \(data\.link\) \{([\s\S]*?)\} else \{/);
    assert(successBranch, "Frontend must keep a separate successful-result branch.");
    assert(successBranch[1].includes("activateOfficialSiteButton(query);"), "Successful result must activate Official Website when Open official result activates.");
  }

  assert.strictEqual(normaliseKey("YouTube Premium"), "youtubepremium");
  assert.strictEqual(normaliseKey("youtube-premium"), "youtubepremium");
  assert.strictEqual(deriveOfficialSiteUrl("https://www.netflix.com/cancelplan", "Netflix"), "https://www.netflix.com/");
  assert.strictEqual(
    deriveOfficialSiteUrl("https://www.amazon.de/mm/two-click/express-cancel?ref_=nav_footer", "Amazon"),
    "https://www.amazon.com/"
  );
  assert.strictEqual(
    deriveOfficialSiteUrl("https://www.amazon.de/mm/two-click/express-cancel?ref_=nav_footer"),
    "",
    "German result URLs must not be blindly stripped into German homepages."
  );
  assert.strictEqual(deriveOfficialSiteUrl("https://www.canva.com/help/cancel-canva-plan/", "Canva"), "https://www.canva.com/");
  assert.strictEqual(deriveOfficialSiteUrl("https://support.apple.com/en-us/118428", "Apple"), "https://www.apple.com/");
  assert.strictEqual(deriveOfficialSiteUrl("https://support.apple.com/billing", "Apple"), "https://www.apple.com/");
  assert.strictEqual(deriveOfficialSiteUrl("https://help.dropbox.com/", "Dropbox"), "https://www.dropbox.com/");
  assert.strictEqual(deriveOfficialSiteUrl("https://www.spotify.com/de-en/signed-out/cancel/", "Spotify"), "https://www.spotify.com/");
  assert.strictEqual(deriveOfficialSiteUrl("https://translate.google.com/?u=https://example.com"), "");

  assertVerified("Netflix subscription", "Netflix", "netflix.com");
  assertVerified("Spotify", "Spotify", "spotify.com");
  assertVerified("Amazon", "Amazon", "amazon.de/mm/two-click/express-cancel");
  assertVerified("Amazon Prime", "Amazon", "amazon.de/mm/two-click/express-cancel");
  assertVerified("Nintendo", "Nintendo", "nintendo.com");
  assertVerified("Microsoft", "Microsoft", "support.microsoft.com/en-US/accounts-billing/subscriptions/cancel-your-microsoft-subscription");
  assertVerified("ChatGPT", "ChatGPT / OpenAI", "help.openai.com");
  assertVerified("OpenAI", "ChatGPT / OpenAI", "help.openai.com");
  assertVerified("Canva", "Canva", "canva.com/help/cancel-canva-plan");
  assertVerified("Stan", "Stan", "help.stan.com.au/hc/en-us/articles/202759790-How-do-I-cancel-my-Stan-account");
  assertVerified("HelloFresh", "HelloFresh", "hellofresh.com/about/how-to-cancel-hellofresh-subscription");

  assert(server.includes('require("./reviewQueue")'), "Server must use the internal JSON review queue.");
  assert(server.includes("recordReviewCandidate(query, result"), "Server must record good non-verified results for review.");
  assert(!server.includes("kickenut-review-candidates.csv"), "Old CSV review candidate file must not be used.");
  assert(!server.includes("csvEscape"), "Old CSV review candidate writer must be removed.");
  assert(fs.existsSync(path.join(root, "data", "reviewCandidates.json")), "JSON review queue file must exist.");

  const reviewTestFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "kickenut-review-test-")),
    "reviewCandidates.json"
  );

  assert.strictEqual(canonicalReviewUrl("https://example.com/cancel?ref=123&utm_source=test#section"), "https://example.com/cancel");
  assert.strictEqual(recordReviewCandidate("netflix", getVerifiedResult("netflix"), { filePath: reviewTestFile }), null);
  assert.strictEqual(recordReviewCandidate("amazon", getVerifiedResult("amazon"), { filePath: reviewTestFile }), null);
  assert.strictEqual(recordReviewCandidate("canva", getVerifiedResult("canva"), { filePath: reviewTestFile }), null);
  assert.deepStrictEqual(readReviewCandidates(reviewTestFile), [], "Verified saved results must not create review candidates.");

  const appleReview = recordReviewCandidate("apple", makeLiveReviewResult(), {
    filePath: reviewTestFile,
    officialSite: "https://www.apple.com/",
    now: "2026-07-21T00:00:00.000Z"
  });
  assert(appleReview, "Good Apple-style live result should create a pending review candidate.");
  assert.strictEqual(appleReview.status, "pending_review");
  assert.strictEqual(appleReview.searchedQuery, "apple");
  assert.strictEqual(appleReview.url, "https://support.apple.com/en-us/118428");
  assert.strictEqual(appleReview.canonicalUrl, "https://support.apple.com/en-us/118428");
  assert.strictEqual(appleReview.officialSite, "https://www.apple.com/");
  assert.strictEqual(appleReview.timesSeen, 1);

  const duplicateAppleReview = recordReviewCandidate("apple", makeLiveReviewResult({
    link: "https://support.apple.com/en-us/118428?utm_source=duplicate"
  }), {
    filePath: reviewTestFile,
    officialSite: "https://www.apple.com/",
    now: "2026-07-21T00:05:00.000Z"
  });
  assert.strictEqual(duplicateAppleReview.timesSeen, 2, "Duplicate review candidates must update timesSeen.");
  assert.strictEqual(duplicateAppleReview.lastSeen, "2026-07-21T00:05:00.000Z");
  assert.strictEqual(readReviewCandidates(reviewTestFile).length, 1, "Duplicate review candidates must not add a second entry.");

  const stanStyleReview = recordReviewCandidate("review stream", makeLiveReviewResult({
    company: "Review Stream",
    title: "Review Stream official cancellation route",
    link: "https://reviewstream.com/cancel-subscription",
    resultType: "Official cancellation route",
    tier: "Tier 1 candidate",
    notes: "Official help article explains how to cancel a subscription."
  }), {
    filePath: reviewTestFile,
    officialSite: "https://reviewstream.com/",
    now: "2026-07-21T00:10:00.000Z"
  });
  assert(stanStyleReview, "Good Stan-style non-verified live result should create a pending review candidate.");
  assert.strictEqual(stanStyleReview.status, "pending_review");
  assert.strictEqual(readReviewCandidates(reviewTestFile).length, 2);

  assert.strictEqual(recordReviewCandidate("netflix", makeLiveReviewResult({
    company: "Netflix",
    link: "https://www.netflix.com/cancelplan?ref=duplicate",
    title: "Netflix official cancellation route"
  }), { filePath: reviewTestFile }), null, "URLs already saved in verifiedResults.js must not be queued.");
  assert.strictEqual(recordReviewCandidate("stan", makeLiveReviewResult({
    company: "Stan",
    link: "https://help.stan.com.au/hc/en-us/articles/202759790-How-do-I-cancel-my-Stan-account",
    title: "Stan official cancellation route"
  }), { filePath: reviewTestFile }), null, "Promoted Stan URL must not be queued again.");
  assert.strictEqual(recordReviewCandidate("hellofresh", makeLiveReviewResult({
    company: "HelloFresh",
    link: "https://www.hellofresh.com/about/how-to-cancel-hellofresh-subscription",
    title: "HelloFresh official cancellation route"
  }), { filePath: reviewTestFile }), null, "Promoted HelloFresh URL must not be queued again.");

  assert.strictEqual(recordReviewCandidate("stan", {
    error: "No official cancellation route found yet.",
    company: "Stan",
    searched: true,
    officialSite: "https://www.stan.com.au/"
  }, { filePath: reviewTestFile }), null, "No-result officialSite fallback must not be queued.");

  assert.strictEqual(recordReviewCandidate("Market Only", makeLiveReviewResult({
    company: "Market Only",
    title: "Market Only help homepage",
    link: "https://marketonly.com/help",
    resultType: "Official support homepage",
    notes: "Generic support and marketing content."
  }), { filePath: reviewTestFile }), null, "Weak generic help pages must not be queued.");

  assert.strictEqual(readReviewCandidates(reviewTestFile).length, 2, "Only strong non-verified review candidates should be saved.");

  const verifiedResultsBeforeHealthTests = fs.readFileSync(path.join(root, "data", "verifiedResults.js"), "utf8");
  const healthTestFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "kickenut-health-test-")),
    "verifiedHealth.json"
  );
  const healthFixtures = [
    {
      company: "Healthy",
      url: "https://healthy.example/cancel",
      notes: "Healthy fixture."
    },
    {
      company: "Broken",
      url: "https://broken.example/cancel",
      notes: "404 fixture."
    },
    {
      company: "Gone",
      url: "https://gone.example/cancel",
      notes: "410 fixture."
    },
    {
      company: "Server",
      url: "https://server.example/cancel",
      notes: "5xx fixture."
    },
    {
      company: "Timeout",
      url: "https://timeout.example/cancel",
      notes: "Timeout fixture."
    },
    {
      company: "Soft",
      url: "https://soft.example/cancel",
      notes: "Soft 404 fixture."
    },
    {
      company: "Parked",
      url: "https://parked.example/cancel",
      notes: "Parking fixture."
    },
    {
      company: "Redirect",
      url: "https://redirect.example/cancel",
      notes: "Homepage redirect fixture."
    },
    {
      company: "Mismatch",
      url: "https://mismatch.example/cancel",
      notes: "Domain mismatch fixture."
    },
    {
      company: "Generic",
      url: "https://generic.example/help",
      notes: "Generic help fixture."
    },
    {
      company: "Login",
      url: "https://login.example/account",
      notes: "Restricted account fixture."
    }
  ];
  const firstHealth = await runVerifiedHealthCheck({
    verifiedResults: healthFixtures,
    fetchImpl: fakeVerifiedHealthFetch,
    healthFile: healthTestFile,
    now: "2026-07-21T01:00:00.000Z"
  });
  const firstHealthByCompany = new Map(firstHealth.entries.map((entry) => [entry.company, entry]));
  assert.strictEqual(firstHealth.checked, healthFixtures.length);
  assert.strictEqual(firstHealthByCompany.get("Healthy").status, "healthy");
  assert(firstHealthByCompany.get("Healthy").detectedSignals.includes("cancellation"));
  assert.strictEqual(firstHealthByCompany.get("Broken").status, "warning", "One 404 check should only create a warning.");
  assert.strictEqual(firstHealthByCompany.get("Gone").status, "warning");
  assert.strictEqual(firstHealthByCompany.get("Server").status, "warning");
  assert.strictEqual(firstHealthByCompany.get("Timeout").reason, "Timeout while fetching verified URL.");
  assert.strictEqual(firstHealthByCompany.get("Soft").reason, "Soft-404 style page detected.");
  assert.strictEqual(firstHealthByCompany.get("Parked").reason, "Parking/domain-for-sale page detected.");
  assert.strictEqual(
    firstHealthByCompany.get("Redirect").reason,
    "Redirected to a homepage without cancellation/subscription/account-management signals."
  );
  assert.strictEqual(firstHealthByCompany.get("Mismatch").reason, "Redirect ended on a different company/domain network.");
  assert.strictEqual(firstHealthByCompany.get("Generic").reason, "Generic help/support homepage without clear cancellation intent.");
  assert.strictEqual(firstHealthByCompany.get("Login").status, "warning", "Restricted login/account pages should be treated carefully.");
  assert.strictEqual(firstHealthByCompany.get("Login").failureCount, 0, "Restricted login/account pages should not increase failure count.");
  assert.strictEqual(readVerifiedHealth(healthTestFile).length, healthFixtures.length);

  const repeatedFailureFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "kickenut-health-repeat-test-")),
    "verifiedHealth.json"
  );
  const brokenOnly = [healthFixtures.find((fixture) => fixture.company === "Broken")];
  await runVerifiedHealthCheck({
    verifiedResults: brokenOnly,
    fetchImpl: fakeVerifiedHealthFetch,
    healthFile: repeatedFailureFile,
    now: "2026-07-21T01:10:00.000Z"
  });
  await runVerifiedHealthCheck({
    verifiedResults: brokenOnly,
    fetchImpl: fakeVerifiedHealthFetch,
    healthFile: repeatedFailureFile,
    now: "2026-07-21T01:11:00.000Z"
  });
  const repeatedFailure = await runVerifiedHealthCheck({
    verifiedResults: brokenOnly,
    fetchImpl: fakeVerifiedHealthFetch,
    healthFile: repeatedFailureFile,
    now: "2026-07-21T01:12:00.000Z"
  });
  assert.strictEqual(repeatedFailure.entries[0].failureCount, 3);
  assert.strictEqual(repeatedFailure.entries[0].status, "needs_review", "Repeated failures should move to needs_review.");

  const recoveryFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "kickenut-health-recovery-test-")),
    "verifiedHealth.json"
  );
  fs.writeFileSync(recoveryFile, JSON.stringify([
    {
      company: "Recover",
      url: "https://recover.example/cancel",
      canonicalUrl: "https://recover.example/cancel",
      status: "needs_review",
      lastGood: "",
      failureCount: 3
    }
  ], null, 2));
  const recoveredHealth = await runVerifiedHealthCheck({
    verifiedResults: [
      {
        company: "Recover",
        url: "https://recover.example/cancel",
        notes: "Recovery fixture."
      }
    ],
    fetchImpl: fakeVerifiedHealthFetch,
    healthFile: recoveryFile,
    now: "2026-07-21T01:20:00.000Z"
  });
  assert.strictEqual(recoveredHealth.entries[0].status, "healthy");
  assert.strictEqual(recoveredHealth.entries[0].failureCount, 0);
  assert.strictEqual(recoveredHealth.entries[0].lastGood, "2026-07-21T01:20:00.000Z");
  assert.strictEqual(
    fs.readFileSync(path.join(root, "data", "verifiedResults.js"), "utf8"),
    verifiedResultsBeforeHealthTests,
    "Verified URL health checks must never write to verifiedResults.js."
  );

  const youtubeSeed = getCompanySeed("youtube-premium");
  assert(!youtubeSeed, "YouTube Premium seed should not exist until it has a good enough route.");

  const domainSeed = getCompanySeed("example.com");
  assert(domainSeed, "Domain-style searches should build a temporary seed.");
  assert.strictEqual(domainSeed.officialDomains[0], "example.com");

  fetchCalls.length = 0;
  const germanCandidateSeed = {
    company: "German Seed",
    aliases: ["german seed"],
    officialDomains: ["germanseed.de", "germanseed.com"],
    germanStartUrls: [],
    englishStartUrls: [],
    candidateUrls: [
      "https://germanseed.com/cancel-subscription",
      "https://germanseed.de/kuendigung"
    ]
  };
  const germanCandidate = await discoverOfficialRoute("German Seed", germanCandidateSeed, {
    fetchImpl: fakeOfficialFetch,
    disableDiscoveryCache: true,
    maxPages: 6
  });
  assert(germanCandidate.link, "German candidate URL should be accepted.");
  assert.strictEqual(germanCandidate.link, "https://germanseed.de/kuendigung");
  assert.strictEqual(fetchCalls[0], "https://germanseed.de/kuendigung", "German candidate URLs must be checked before English/global candidate URLs.");

  fetchCalls.length = 0;
  const germanDiscoverySeed = {
    company: "German First",
    aliases: ["german first"],
    officialDomains: ["germanfirst.de", "germanfirst.com"],
    germanStartUrls: [],
    englishStartUrls: [],
    candidateUrls: [
      "https://germanfirst.com/cancel-subscription"
    ]
  };
  const germanDiscovery = await discoverOfficialRoute("German First", germanDiscoverySeed, {
    fetchImpl: fakeOfficialFetch,
    disableDiscoveryCache: true,
    maxPages: 12
  });
  assert(germanDiscovery.link, "Known seed candidate discovery should be accepted.");
  assert.strictEqual(germanDiscovery.link, "https://germanfirst.com/cancel-subscription");
  assert.strictEqual(fetchCalls[0], "https://germanfirst.com/cancel-subscription", "Known seed candidate URLs must be checked before weak guessed direct paths.");

  const weakSupportSeed = {
    company: "Market Only",
    aliases: ["market only"],
    officialDomains: ["marketonly.com"],
    germanStartUrls: [],
    englishStartUrls: ["https://marketonly.com/help"],
    candidateUrls: []
  };
  const weakSupport = await discoverOfficialRoute("Market Only", weakSupportSeed, {
    fetchImpl: fakeOfficialFetch,
    disableDiscoveryCache: true,
    maxPages: 4
  });
  assert(!weakSupport, "Generic support/help pages without cancellation or subscription-management intent must be rejected.");

  fetchCalls.length = 0;
  const billingFirstSeed = {
    company: "Route Rank",
    aliases: ["route rank"],
    officialDomains: ["ranktest.com"],
    germanStartUrls: [],
    englishStartUrls: [],
    candidateUrls: [
      "https://ranktest.com/billing",
      "https://ranktest.com/cancel"
    ]
  };
  const billingFirstResult = await discoverOfficialRoute("Route Rank", billingFirstSeed, {
    fetchImpl: fakeOfficialFetch,
    disableDiscoveryCache: true,
    maxPages: 4
  });
  assert(billingFirstResult.link, "Seed candidate ranking should return a valid route.");
  assert.strictEqual(
    billingFirstResult.link,
    "https://ranktest.com/cancel",
    "Direct cancellation seed candidates must beat broader billing/subscription seed candidates."
  );
  assert(fetchCalls.includes("https://ranktest.com/billing"), "Billing seed candidate should be checked.");
  assert(fetchCalls.includes("https://ranktest.com/cancel"), "Direct cancellation seed candidate should be checked before returning.");

  fetchCalls.length = 0;
  const sky = await searchCancellationRoute("Sky", {
    fetchImpl: fakeOfficialFetch,
    disableDiscoveryCache: true,
    maxPages: 12
  });
  assert(sky.link, "Sky should return an official German route.");
  assert.strictEqual(sky.company, "Sky");
  assert.strictEqual(sky.source, "live-official-site-discovery");
  assert.strictEqual(sky.link, "https://www.sky.de/online-kuendigung");

  fetchCalls.length = 0;
  const canva = await searchCancellationRoute("canva", {
    fetchImpl: fakeOfficialFetch,
    disableDiscoveryCache: true,
    maxPages: 4
  });
  assert(canva.link, "Canva should return a verified saved result.");
  assert.strictEqual(canva.company, "Canva");
  assert.strictEqual(canva.source, "verified");
  assert.strictEqual(canva.verified, true);
  assert.strictEqual(canva.confidence, "High");
  assert.strictEqual(canva.link, "https://www.canva.com/help/cancel-canva-plan/");
  assert.strictEqual(fetchCalls.length, 0, "Verified Canva should return before live discovery.");

  const liveCanva = await discoverOfficialRoute("canva", getCompanySeed("canva"), {
    fetchImpl: fakeOfficialFetch,
    disableDiscoveryCache: true,
    maxPages: 30
  });
  assert(liveCanva.link, "Canva seed candidate should still work through universal live discovery.");
  assert.strictEqual(liveCanva.source, "live-official-site-discovery");
  assert.strictEqual(liveCanva.verified, false);
  assert.strictEqual(liveCanva.link, "https://www.canva.com/help/cancel-canva-plan/");

  const figma = await searchCancellationRoute("Figma", {
    fetchImpl: fakeOfficialFetch,
    disableDiscoveryCache: true,
    maxPages: 30
  });
  assert(figma.link, "Wikidata-discovered company should use the universal official-site crawler.");
  assert.strictEqual(figma.company, "Figma");
  assert.strictEqual(figma.source, "live-official-site-discovery");
  assert.strictEqual(figma.verified, false);
  assert.strictEqual(figma.link, "https://figma.com/cancel");

  const guessedSeed = await discoverCompanySeed("Launch Widget", {
    fetchImpl: fakeOfficialFetch,
    disableDiscoveryCache: true
  });
  assert(guessedSeed, "Safe domain guessing should identify a strongly matching official site.");
  assert.strictEqual(guessedSeed.officialDomains[0], "launchwidget.com");

  const apple = await searchCancellationRoute("apple", {
    fetchImpl: fakeOfficialFetch,
    disableDiscoveryCache: true,
    maxPages: 40
  });
  assert(apple.link, "Apple should return the best official Apple cancellation or subscription route.");
  assert.strictEqual(apple.company, "Apple");
  assert.strictEqual(apple.source, "live-official-site-discovery");
  assert.strictEqual(apple.link, "https://support.apple.com/en-us/118428");
  assert(!apple.link.includes("canva.com"), "Apple must never return the Canva link.");

  const appleAgain = await searchCancellationRoute("apple", {
    fetchImpl: fakeOfficialFetch,
    disableDiscoveryCache: true,
    maxPages: 40
  });
  assert.strictEqual(
    appleAgain.link,
    "https://support.apple.com/en-us/118428",
    "Repeated Apple searches should return the same best result."
  );

  const stan = await searchCancellationRoute("stan", {
    fetchImpl: fakeOfficialFetch,
    disableDiscoveryCache: true,
    maxPages: 40
  });
  assert(stan.link, "Stan should return an official Stan route.");
  assert.strictEqual(stan.company, "Stan");
  assert.strictEqual(stan.source, "verified");
  assert.strictEqual(stan.verified, true);
  assert.strictEqual(stan.link, "https://help.stan.com.au/hc/en-us/articles/202759790-How-do-I-cancel-my-Stan-account");

  const google = await searchCancellationRoute("google", {
    fetchImpl: fakeOfficialFetch,
    disableDiscoveryCache: true,
    maxPages: 50
  });
  assert(google.link, "Google should return an official Google route.");
  assert.strictEqual(google.company, "Google");
  assert.strictEqual(google.source, "live-official-site-discovery");
  assert.strictEqual(google.link, "https://support.google.com/googleplay/workflow/9827184?hl=en");

  const helloFresh = await searchCancellationRoute("HelloFresh", {
    fetchImpl: fakeOfficialFetch,
    disableDiscoveryCache: true,
    maxPages: 24
  });
  assert(helloFresh.link, "HelloFresh should return a verified official HelloFresh route.");
  assert.strictEqual(helloFresh.company, "HelloFresh");
  assert.strictEqual(helloFresh.source, "verified");
  assert.strictEqual(helloFresh.verified, true);
  assert.strictEqual(helloFresh.link, "https://www.hellofresh.com/about/how-to-cancel-hellofresh-subscription");

  for (const query of ["Disney", "Adobe", "YouTube Premium"]) {
    const result = await searchCancellationRoute(query, {
      fetchImpl: fakeOfficialFetch,
      disableDiscoveryCache: true
    });
    assert(!result.link, `${query} must remain a clean no-result for now.`);
    assert(result.error.startsWith("No official cancellation route found yet."));
    assert(!result.officialSite, `${query} must not activate Official Website without a safe known official site.`);
  }

  fetchCalls.length = 0;
  const appleNoRoute = await searchCancellationRoute("apple", {
    fetchImpl: async (url) => {
      fetchCalls.push(String(url));
      return htmlResponse("<html><title>Page not found</title><body>Page not found</body></html>", 404);
    },
    disableDiscoveryCache: true,
    maxPages: 8
  });
  assert(!appleNoRoute.link, "Apple no-result fallback test should not return a cancellation route.");
  assert(appleNoRoute.error.startsWith("No official cancellation route found yet."));
  assert.strictEqual(appleNoRoute.officialSite, "https://www.apple.com/", "Apple no-result should expose its safe known official website.");

  fetchCalls.length = 0;
  const dropboxNoRoute = await searchCancellationRoute("Dropbox", {
    fetchImpl: fakeOfficialFetch,
    disableDiscoveryCache: true,
    maxPages: 8
  });
  assert(!dropboxNoRoute.link, "Dropbox should remain a clean no-result when no safe cancellation route is found.");
  assert(dropboxNoRoute.error.startsWith("No official cancellation route found yet."));
  assert.strictEqual(dropboxNoRoute.officialSite, "https://www.dropbox.com/", "Dropbox no-result should expose its safe official website.");
  assert(fetchCalls.every((url) => !url.includes("google.com/search")), "Dropbox fallback must not use search engines.");

  fetchCalls.length = 0;
  const unknown = await searchCancellationRoute("zzzzunknowncompany", {
    fetchImpl: fakeOfficialFetch,
    disableDiscoveryCache: true,
    maxPages: 4
  });
  assert(!unknown.link, "Unknown company must not return a guessed link.");
  assert(unknown.error.startsWith("No official cancellation route found yet."));
  assert.strictEqual(unknown.searched, true);
  assert(!unknown.officialSite, "Unknown company must not activate Official Website without a safe known official site.");
  assert(fetchCalls.some((url) => url.includes("wikidata.org/w/api.php")), "Unknown company should try Wikidata discovery first.");
  assert(fetchCalls.some((url) => url.includes("zzzzunknowncompany.com")), "Unknown company should try safe domain candidates before no-result.");

  console.log("Kickenut launch search-engine checks passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
