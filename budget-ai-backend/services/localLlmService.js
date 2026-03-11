const axios = require("axios");

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b";

async function generateLocalResponse(prompt, options = {}) {
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS || 90000);
  const response = await axios.post(
    `${OLLAMA_URL}/api/generate`,
    {
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options
    },
    { timeout: timeoutMs }
  );

  return response.data?.response || "";
}

module.exports = {
  generateLocalResponse
};
