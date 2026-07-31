# Kickenut Launch Readiness Report

Generated: 2026-07-30

## Final Status

READY FOR BOSS REVIEW

The local Kickenut code is launch-hardened for a Render-first launch and all achievable local tests pass. It is not marked "READY TO DEPLOY AFTER BOSS APPROVAL" yet because this folder is not a Git repository, no GitHub remote is configured, and the current Render production service/version could not be compared from this workspace.

## Project Path

`/Users/account-1/Desktop/kickenut-Final`

The old workspace at `/Users/account-1/Documents/Codex/2026-06-21/wh` was not used. `/Users/account-1/Desktop/SecurityScannerPrototype` was not modified; only a read-only directory listing was run to confirm it was separate.

## Git Branch And Status

- `git status --short --branch`: failed with `fatal: not a git repository (or any of the parent directories): .git`
- `git remote -v`: failed with `fatal: not a git repository (or any of the parent directories): .git`
- Current branch: unavailable
- Remote: unavailable
- GitHub/Render comparison: unavailable from this folder because there is no `.git` repository or remote metadata

## Files Changed

- `.env.example`
- `.gitignore`
- `LAUNCH_READINESS_REPORT.md`
- `data/verifiedHealth.json`
- `jsonStorage.js`
- `load-test.js`
- `package-lock.json`
- `package.json`
- `render.yaml`
- `reviewQueue.js`
- `runtimeProtection.js`
- `searchEngine.js`
- `server.js`
- `test-launch-protections.js`
- `verifiedHealth.js`

## Launch Protections Added

- Positive and negative search-result caching with TTLs and bounded entry count.
- Discovered-domain cache expiration and max-entry pruning.
- Duplicate in-flight request coalescing by normalized query.
- Search concurrency limit and bounded queue with graceful overload errors.
- Queue wait timeout so overloaded searches do not wait indefinitely.
- Per-IP and per-query sliding-window rate limiting.
- Verified saved-result searches bypass live-discovery rate limits so common verified lookups are not harmed.
- Runtime search timeouts with abort propagation into crawler fetches.
- Safe shutdown for queued/in-flight work on `SIGINT` and `SIGTERM`.
- Atomic JSON writes and corrupt JSON quarantine fallback.
- Bounded Review Queue growth with newest-candidate retention.
- Structured JSON logs for startup, shutdown, HTTP requests, search completion, and failures.
- `/health` and `/ready` endpoints, with `/healthz` and `/readyz` aliases kept for compatibility.
- `/metrics` operational endpoint.
- Metrics for searches, cache hits, failures, latency, rate limits, queue pressure, overload, and config.
- Secure headers: CSP, frame denial, no-sniff, referrer policy, permissions policy, COOP.
- Production-safe generic error responses.
- Explicit page serving only; the server no longer exposes the whole project root as static files.
- Render Blueprint config in `render.yaml`.

## Cache And Rate-Limit Configuration

Defaults in code and `render.yaml`:

- `KICKENUT_MAX_CONCURRENT_SEARCHES=4`
- `KICKENUT_MAX_QUEUE_SIZE=24`
- `KICKENUT_QUEUE_TIMEOUT_MS=3000`
- `KICKENUT_CACHE_MAX_ENTRIES=500`
- `KICKENUT_CACHE_POSITIVE_TTL_MS=43200000` (12 hours)
- `KICKENUT_CACHE_NEGATIVE_TTL_MS=600000` (10 minutes)
- `KICKENUT_IP_RATE_LIMIT_MAX=60` per window
- `KICKENUT_QUERY_RATE_LIMIT_MAX=20` per window
- Rate-limit window defaults: 60 seconds
- `KICKENUT_SEARCH_TIMEOUT_MS=10000`
- `KICKENUT_DEEP_SEARCH_TIMEOUT_MS=12000`
- `KICKENUT_REVIEW_CANDIDATES_MAX_ENTRIES=500`
- Discovered-domain cache TTL: 30 days
- Discovered-domain cache max entries: 250

## Search Quality Checks

Confirmed by `npm run test:search`:

- `verifiedResults.js` is checked before live discovery.
- `companySeeds.js` remains supported.
- Unknown companies still attempt safe official-domain discovery.
- Discovered domains are validated with brand evidence, official-host checks, soft-404 rejection, and parking-page rejection.
- Third-party/community/blog/forum-style results remain rejected.
- Spotify podcast/content pages remain blocked by the negative-candidate rules.
- Live discoveries are not automatically saved as verified results.
- Review Queue candidates remain pending and never automatically become verified results.
- Health checks never write to `verifiedResults.js`.
- Result opening remains button-only through "Open official result".
- Result links use `target="_blank"` and `rel="noopener noreferrer"`.
- The UI keeps the dark style, red-outline Kickenut heading, loading bar for verified results, stale-response protection, and four ad slots.

## Tests Run

- `npm run check:syntax --silent`: passed.
- `npm test --silent`: passed.
- `npm run test:search --silent`: passed.
- `npm run test:launch --silent`: passed.
- `npm run test:load --silent`: passed.
- JSON integrity check for `data/*.json`, `package.json`, and `package-lock.json`: passed.
- Health-check behavior tests inside `npm run test:search --silent`: passed.
- Static-file exposure security tests inside `npm run test:launch --silent`: passed.
- Rate-limit, cache, negative-cache, duplicate-request, queue-overload, queue-timeout, graceful-shutdown, safe JSON-write, corruption-recovery, health/readiness route, and static-exposure tests: passed.

Note: live `npm run health:verified` was not rerun during this final pass because this turn did not approve external network access. The internal health-check tests passed locally and the existing `data/verifiedHealth.json` remains valid JSON.

## Load-Test Results

Command: `npm run test:load --silent`

- Total deterministic requests: 180
- Runner calls: 4
- Duration: 18 ms
- Completed: 180
- Coalesced duplicate requests: 176
- Overloaded: 0
- Average latency: 14 ms
- Max latency: 18 ms
- Max active searches: 4
- Max queued searches: 0

This is a deterministic local stress test with a fake search runner, intended to prove cache/coalescing/queue behavior without hitting official company sites.

## Verified URL Health Results

Existing saved health report in `data/verifiedHealth.json`:

- Checked: 9
- Healthy: 6
- Warning: 3
- Needs review: 0
- Failed: 0

Healthy:

- Netflix
- Amazon
- Spotify
- HelloFresh
- Nintendo
- Microsoft

Warnings:

- Canva: HTTP 403 access restricted/rate limited.
- Stan: HTTP 403 access restricted/rate limited.
- ChatGPT / OpenAI: HTTP 403 access restricted/rate limited.

The warnings do not modify verified results and are consistent with protected/help/login pages refusing automated health checks.

## Secrets And Credentials

- No `.env` file was found.
- `.env.example` contains placeholders only.
- `.gitignore` now excludes `.env`, `.env.*`, logs, temporary files, corrupt JSON quarantine files, and `node_modules/`.
- Secret scan found no actual credentials. The only matches were ordinary code words such as `token` in search logic.
- Because this folder is not a Git repository, "committed secrets" cannot be verified locally.

## Render Production Configuration

`render.yaml` prepares a Node web service:

- Service type: `web`
- Runtime: `node`
- Plan: `standard`
- Build command: `npm ci`
- Start command: `npm start`
- Health check path: `/health`
- Node version: Node 20 or newer, enforced by `package.json` `engines.node >=20`
- Auto deploy: off (`autoDeployTrigger: off`)
- Shutdown delay: 30 seconds

This follows the current Render Blueprint guidance for `runtime: node`, `buildCommand`, `startCommand`, `healthCheckPath`, `autoDeployTrigger`, and `maxShutdownDelaySeconds`: https://render.com/docs/blueprint-spec and https://render.com/docs/health-checks

Paid instance recommendation: use Render `standard` or better for launch testing. Avoid free/sleeping services for the public launch because Kickenut relies on predictable response timing, queue limits, and in-memory cache warmth.

## Required Render Environment Variables

Required:

- `NODE_ENV=production`
- `KICKENUT_ALLOWED_ORIGINS=https://<render-service>.onrender.com,https://<custom-domain-if-used>`

Recommended defaults:

- `KICKENUT_MAX_CONCURRENT_SEARCHES=4`
- `KICKENUT_MAX_QUEUE_SIZE=24`
- `KICKENUT_QUEUE_TIMEOUT_MS=3000`
- `KICKENUT_CACHE_MAX_ENTRIES=500`
- `KICKENUT_CACHE_POSITIVE_TTL_MS=43200000`
- `KICKENUT_CACHE_NEGATIVE_TTL_MS=600000`
- `KICKENUT_IP_RATE_LIMIT_MAX=60`
- `KICKENUT_QUERY_RATE_LIMIT_MAX=20`
- `KICKENUT_SEARCH_TIMEOUT_MS=10000`
- `KICKENUT_DEEP_SEARCH_TIMEOUT_MS=12000`
- `KICKENUT_SHUTDOWN_GRACE_MS=5000`
- `KICKENUT_REVIEW_CANDIDATES_MAX_ENTRIES=500`

No paid search API keys are required.

## Exact Render Deployment Steps For Boss Approval

1. Create or reconnect this exact folder as a Git repository.
2. Review the changed files listed above.
3. Commit the launch-readiness changes.
4. Push to the GitHub repository that Render should deploy from.
5. In Render, create or update the Kickenut web service from that GitHub repo.
6. Use the checked-in `render.yaml`, or manually set:
   - Runtime: Node
   - Build Command: `npm ci`
   - Start Command: `npm start`
   - Health Check Path: `/health`
   - Plan: Standard
   - Auto deploy: off for first launch
7. Set `NODE_ENV=production`.
8. Set `KICKENUT_ALLOWED_ORIGINS` to the Render URL first, then add the custom domain after DNS is confirmed.
9. Deploy a preview/manual deploy.
10. Verify `/health`, `/ready`, `/metrics`, `/`, and `/search?q=Netflix` on Render.
11. Perform a manual search-quality check for saved verified results and one unknown company.
12. Only after Boss approval, connect or change custom domain/DNS.

No live deployment, DNS change, paid-plan upgrade, or production environment modification was performed.

## Rollback Procedure

- Render: use Render's previous successful deploy rollback from the service deploy history.
- Git: revert the launch-readiness commit and redeploy the previous commit.
- Local data: restore `data/discoveredDomains.json`, `data/reviewCandidates.json`, and `data/verifiedHealth.json` from the latest known-good backup.
- Corrupt local JSON: the app quarantines unreadable JSON as `*.corrupt-*` and falls back safely; restore from backup if the active file needs manual recovery.
- Verified results: `data/verifiedResults.js` remains the authoritative source and was not modified by health checks.

## Backup And Recovery Instructions

- Before deployment, create a dated backup of this folder or commit/tag the launch candidate.
- Keep `data/verifiedResults.js`, `data/companySeeds.js`, and the current `data/*.json` files in the backup.
- Do not restore the older bundled `kickenut-Final 2.zip` over this project.
- For production, prefer moving mutable JSON state to managed storage later; for Render-first launch, the current local JSON handling is safer but still tied to instance filesystem behavior.

## Domain And DNS Status

- No DNS changes were made.
- No production Render domain was changed.
- Custom domain status is unknown from this workspace.
- Recommended first launch path: verify on the Render `onrender.com` URL, then connect DNS after Boss approval.

## Advertising Readiness

- Four ad spaces are preserved: top banner plus three lower ad boxes.
- No ad network production tags or publisher IDs were added.
- Advertising launch still requires Boss-approved ad-provider snippets/IDs and any required privacy/compliance copy.

## Remaining Risks

- This folder is not a Git repository, so branch, remote, GitHub state, and Render deployed revision cannot be verified.
- Render deployment has not been performed.
- Production environment variables have not been set on Render.
- Domain/DNS status is unknown.
- Render filesystem persistence is not a long-term data-store strategy for review/health JSON state.
- Canva, Stan, and OpenAI health checks return HTTP 403 warnings from automated checks and should be manually reviewed in-browser before launch.
- The CSP still allows inline scripts/styles because the current UI is a single HTML file with inline CSS and JS.

## Unresolved Launch Blockers

- GitHub/Render source-of-truth must be established from this folder.
- Boss must approve Render Standard plan usage and the first production deploy.
- Boss must approve any DNS/custom-domain changes.
- Boss must provide/approve advertising tags before ads can go live.
