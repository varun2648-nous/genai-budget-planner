const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { logApiCallError } = require("../utils/apiErrorLogger");

const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const OPENROUTER_CHAT_MODEL = process.env.OPENROUTER_CHAT_MODEL || "openai/gpt-oss-120b";
const OPENROUTER_EMBED_MODEL = process.env.OPENROUTER_EMBED_MODEL || "nomic-ai/nomic-embed-text-v1.5";
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-1.5-flash";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b";
const AI_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 90000);
const EMBED_TIMEOUT_MS = Number(process.env.EMBED_TIMEOUT_MS || 30000);
const STATUS_TIMEOUT_MS = Number(process.env.PROVIDER_STATUS_TIMEOUT_MS || 5000);

let geminiClient;

function getGeminiClient() {
  if (!process.env.GEMINI_API_KEY) {
    const error = new Error("Gemini API key is missing. Add GEMINI_API_KEY in the backend .env file.");
    error.code = "GEMINI_API_KEY_MISSING";
    error.provider = "gemini";
    throw error;
  }

  if (!geminiClient) {
    geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }

  return geminiClient;
}

function getOpenRouterHeaders() {
  if (!process.env.OPENROUTER_API_KEY) {
    const error = new Error("OpenRouter API key is missing. Add OPENROUTER_API_KEY in the backend .env file.");
    error.code = "OPENROUTER_API_KEY_MISSING";
    error.provider = "openrouter";
    throw error;
  }

  const headers = {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json"
  };

  if (process.env.OPENROUTER_SITE_URL) {
    headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL;
  }

  if (process.env.OPENROUTER_APP_NAME) {
    headers["X-Title"] = process.env.OPENROUTER_APP_NAME;
  }

  return headers;
}

function resolveTextProvider(modelChoice) {
  const normalized = String(modelChoice || "gemini").trim().toLowerCase();

  if (normalized === "openrouter") {
    return {
      provider: "openrouter",
      model: OPENROUTER_CHAT_MODEL
    };
  }

  if (["local", "ollama", "llama"].includes(normalized)) {
    return {
      provider: "local",
      model: OLLAMA_MODEL
    };
  }

  return {
    provider: "gemini",
    model: GEMINI_TEXT_MODEL
  };
}

async function generateText({ modelChoice, prompt, systemPrompt = "", temperature = 0.3 }) {
  const target = resolveTextProvider(modelChoice);

  try {
    if (target.provider === "openrouter") {
      return await generateOpenRouterText({ target, prompt, systemPrompt, temperature });
    }

    if (target.provider === "local") {
      return await generateLocalText({ target, prompt, systemPrompt, temperature });
    }

    return await generateGeminiText({ target, prompt, systemPrompt, temperature });
  } catch (error) {
    const normalized = normalizeProviderError(error, target.provider, target.model);
    await logApiCallError({
      provider: normalized.provider,
      model: normalized.model,
      operation: "generateText",
      code: normalized.code,
      message: normalized.message
    });
    throw normalized;
  }
}

async function generateOpenRouterText({ target, prompt, systemPrompt, temperature }) {
  const response = await withTimeout(
    axios.post(
      `${OPENROUTER_BASE_URL}/chat/completions`,
      {
        model: target.model,
        temperature,
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          { role: "user", content: prompt }
        ]
      },
      {
        timeout: AI_TIMEOUT_MS,
        headers: getOpenRouterHeaders()
      }
    ),
    AI_TIMEOUT_MS,
    "OPENROUTER_TIMEOUT"
  );

  const text = response.data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    const error = new Error("OpenRouter returned an empty response.");
    error.code = "OPENROUTER_EMPTY_RESPONSE";
    throw error;
  }

  return {
    provider: "openrouter",
    model: target.model,
    text
  };
}

async function generateLocalText({ target, prompt, systemPrompt, temperature }) {
  const status = await getLocalProviderStatus();
  if (!status.connected) {
    const error = new Error(status.message);
    error.code = "OLLAMA_UNAVAILABLE";
    throw error;
  }

  const combinedPrompt = [systemPrompt, prompt].filter(Boolean).join("\n\n");
  const response = await withTimeout(
    axios.post(
      `${OLLAMA_URL}/api/generate`,
      {
        model: target.model,
        prompt: combinedPrompt,
        stream: false,
        options: {
          temperature
        }
      },
      {
        timeout: AI_TIMEOUT_MS
      }
    ),
    AI_TIMEOUT_MS,
    "OLLAMA_TIMEOUT"
  );

  const text = response.data?.response?.trim();
  if (!text) {
    const error = new Error(`Local LLM responded, but model "${target.model}" returned empty text.`);
    error.code = "OLLAMA_EMPTY_RESPONSE";
    throw error;
  }

  return {
    provider: "local",
    model: target.model,
    text
  };
}

async function generateGeminiText({ target, prompt, systemPrompt, temperature }) {
  const client = getGeminiClient();
  const model = client.getGenerativeModel({ model: target.model });
  const result = await withTimeout(
    model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ text: [systemPrompt, prompt].filter(Boolean).join("\n\n") }]
        }
      ],
      generationConfig: {
        temperature
      }
    }),
    AI_TIMEOUT_MS,
    "GEMINI_TIMEOUT"
  );
  const response = await result.response;
  const text = response.text()?.trim();

  if (!text) {
    const error = new Error("Gemini returned an empty response.");
    error.code = "GEMINI_EMPTY_RESPONSE";
    throw error;
  }

  return {
    provider: "gemini",
    model: target.model,
    text
  };
}

async function createRemoteEmbeddings(texts) {
  const safeTexts = Array.isArray(texts) ? texts.filter(Boolean) : [];
  if (!safeTexts.length) {
    return {
      embeddings: [],
      provider: "none",
      model: "none"
    };
  }

  try {
    const response = await withTimeout(
      axios.post(
        `${OPENROUTER_BASE_URL}/embeddings`,
        {
          model: OPENROUTER_EMBED_MODEL,
          input: safeTexts
        },
        {
          timeout: EMBED_TIMEOUT_MS,
          headers: getOpenRouterHeaders()
        }
      ),
      EMBED_TIMEOUT_MS,
      "OPENROUTER_EMBED_TIMEOUT"
    );

    const embeddings = response.data?.data?.map((item) => item.embedding).filter(Array.isArray) || [];
    if (embeddings.length !== safeTexts.length) {
      const error = new Error("OpenRouter returned an unexpected embedding payload.");
      error.code = "OPENROUTER_EMBED_INVALID";
      throw error;
    }

    return {
      embeddings,
      provider: "openrouter",
      model: OPENROUTER_EMBED_MODEL
    };
  } catch (error) {
    const normalized = normalizeProviderError(error, "openrouter", OPENROUTER_EMBED_MODEL);
    await logApiCallError({
      provider: normalized.provider,
      model: normalized.model,
      operation: "createRemoteEmbeddings",
      code: normalized.code,
      message: normalized.message
    });
    throw normalized;
  }
}

async function getProviderStatuses() {
  const localStatus = await getLocalProviderStatus();

  return {
    gemini: {
      configured: Boolean(process.env.GEMINI_API_KEY),
      connected: Boolean(process.env.GEMINI_API_KEY),
      label: process.env.GEMINI_API_KEY ? "Gemini key configured" : "Gemini key missing"
    },
    openrouter: {
      configured: Boolean(process.env.OPENROUTER_API_KEY),
      connected: Boolean(process.env.OPENROUTER_API_KEY),
      label: process.env.OPENROUTER_API_KEY ? "OpenRouter key configured" : "OpenRouter key missing"
    },
    local: localStatus
  };
}

async function getLocalProviderStatus() {
  try {
    const response = await axios.get(`${OLLAMA_URL}/api/tags`, {
      timeout: STATUS_TIMEOUT_MS
    });
    const models = response.data?.models || [];
    const modelAvailable = models.some((model) => String(model?.name || "").startsWith(OLLAMA_MODEL));

    if (!modelAvailable) {
      return {
        configured: true,
        connected: false,
        label: "LLM not connected",
        message: `Local LLM is reachable at ${OLLAMA_URL}, but model "${OLLAMA_MODEL}" is not available. Pull the model in Ollama first.`
      };
    }

    return {
      configured: true,
      connected: true,
      label: "Local LLM connected",
      message: `Local LLM "${OLLAMA_MODEL}" is reachable at ${OLLAMA_URL}.`
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      label: "LLM not connected",
      message: `Could not reach the local LLM at ${OLLAMA_URL}. Start Ollama and make sure model "${OLLAMA_MODEL}" is available.`
    };
  }
}

function normalizeProviderError(error, provider, model) {
  if (!error) {
    const fallback = new Error("Unknown LLM error.");
    fallback.provider = provider;
    return fallback;
  }

  error.provider = error.provider || provider;
  error.model = error.model || model;
  return error;
}

function formatProviderError(error, fallbackProvider = "llm") {
  return "LLM responded with an error";
}

function withTimeout(promise, timeoutMs, code) {
  let timer;

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(code);
      error.code = code;
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

module.exports = {
  createRemoteEmbeddings,
  formatProviderError,
  generateText,
  getProviderStatuses,
  resolveTextProvider
};
