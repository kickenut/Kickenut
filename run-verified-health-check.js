const { runVerifiedHealthCheck } = require("./verifiedHealth");

runVerifiedHealthCheck()
  .then((summary) => {
    console.log("Kickenut verified URL health check complete.");
    console.log(`Checked: ${summary.checked}`);
    console.log(`Healthy: ${summary.healthy}`);
    console.log(`Warning: ${summary.warning}`);
    console.log(`Needs review: ${summary.needs_review}`);
    console.log(`Failed: ${summary.failed}`);

    for (const entry of summary.entries) {
      console.log(`${entry.company}: ${entry.status} - ${entry.reason}`);
    }
  })
  .catch((err) => {
    console.error("Kickenut verified URL health check failed:", err.message);
    process.exit(1);
  });
