const { GoogleGenerativeAI } = require("@google/generative-ai");

let client;

function getClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  if (!client) {
    client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }

  return client;
}

async function generateGeminiAdvice(prompt) {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS || 90000);
  const result = await withTimeout(model.generateContent(prompt), timeoutMs, "LLM_TIMEOUT");
  const response = await result.response;
  return response.text();
}

function withTimeout(promise, timeoutMs, errorMessage) {
  let timer;

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(errorMessage);
      err.code = errorMessage;
      reject(err);
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

module.exports = {
  generateGeminiAdvice
};
