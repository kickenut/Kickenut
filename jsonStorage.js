const fs = require("fs");
const path = require("path");

function cloneFallback(value) {
  if (Array.isArray(value) || (value && typeof value === "object")) {
    return JSON.parse(JSON.stringify(value));
  }

  return value;
}

function timestampSuffix(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-");
}

function quarantineCorruptFile(filePath, now = new Date()) {
  try {
    if (!fs.existsSync(filePath)) return "";

    const quarantinePath = `${filePath}.corrupt-${timestampSuffix(now)}`;
    fs.copyFileSync(filePath, quarantinePath);
    return quarantinePath;
  } catch {
    return "";
  }
}

function readJsonFile(filePath, fallback, options = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));

    if (options.validate && !options.validate(parsed)) {
      throw new Error("JSON file did not match the expected shape.");
    }

    return parsed;
  } catch (err) {
    if (err.code !== "ENOENT" && options.quarantineCorrupt !== false) {
      quarantineCorruptFile(filePath, options.now || new Date());
    }

    if (typeof options.onError === "function") {
      options.onError(err);
    }

    return cloneFallback(fallback);
  }
}

function writeJsonFileAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );

  fs.mkdirSync(directory, { recursive: true });

  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // Best effort cleanup only.
    }

    throw err;
  }
}

module.exports = {
  quarantineCorruptFile,
  readJsonFile,
  writeJsonFileAtomic
};
