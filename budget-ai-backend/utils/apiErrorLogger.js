const fs = require("fs/promises");
const path = require("path");

const LOG_FILE = path.resolve(__dirname, "..", "..", "api_call_errors.txt");

async function logApiCallError({ provider, model, operation, message, code }) {
  const timestamp = new Date().toISOString();
  const lines = [
    `[${timestamp}]`,
    `provider=${provider || "unknown"}`,
    `model=${model || "unknown"}`,
    `operation=${operation || "unknown"}`,
    `code=${code || "none"}`,
    `message=${String(message || "Unknown error").replace(/\r?\n/g, " ")}`,
    ""
  ];

  await fs.appendFile(LOG_FILE, `${lines.join("\n")}\n`, "utf8");
}

module.exports = {
  logApiCallError
};
