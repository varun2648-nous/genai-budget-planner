const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { logApiCallError } = require("../utils/apiErrorLogger");

const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const OPENROUTER_CHAT_MODEL = process.env.OPENROUTER_CHAT_MODEL || "openai/gpt-oss-120b";
const OPENROUTER_EMBED_MODEL = process.env.OPENROUTER_EMBED_MODEL || "nomic-ai/nomic-embed-text-v1.5";
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-1.5-flash";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b";
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
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
    error.code = status.code || "OLLAMA_UNAVAILABLE";
    error.provider = "local";
    error.model = target.model;
    throw error;
  }

  const combinedPrompt = [systemPrompt, prompt].filter(Boolean).join("\n\n");
  let response;

  try {
    response = await withTimeout(
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
  } catch (error) {
    throw normalizeLocalError(error, target.model);
  }

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

async function createLocalEmbeddings(texts) {
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
        `${OLLAMA_URL}/api/embed`,
        {
          model: OLLAMA_EMBED_MODEL,
          input: safeTexts
        },
        {
          timeout: EMBED_TIMEOUT_MS
        }
      ),
      EMBED_TIMEOUT_MS,
      "OLLAMA_EMBED_TIMEOUT"
    );

    const embeddings = response.data?.embeddings?.filter(Array.isArray) || [];
    if (embeddings.length !== safeTexts.length) {
      const error = new Error(`Ollama returned an unexpected embedding payload for model "${OLLAMA_EMBED_MODEL}".`);
      error.code = "OLLAMA_EMBED_INVALID";
      throw error;
    }

    return {
      embeddings,
      provider: "local",
      model: OLLAMA_EMBED_MODEL
    };
  } catch (error) {
    const normalized = normalizeLocalEmbeddingError(error);
    await logApiCallError({
      provider: normalized.provider,
      model: normalized.model,
      operation: "createLocalEmbeddings",
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
      label: process.env.GEMINI_API_KEY ? "Gemini configured" : "Gemini key missing",
      model: GEMINI_TEXT_MODEL,
      code: process.env.GEMINI_API_KEY ? "GEMINI_CONFIGURED" : "GEMINI_API_KEY_MISSING",
      message: process.env.GEMINI_API_KEY
        ? `Gemini is configured to use model "${GEMINI_TEXT_MODEL}". Use /ai/providers/debug for a live generation check.`
        : "Add GEMINI_API_KEY in the backend .env file."
    },
    openrouter: {
      configured: Boolean(process.env.OPENROUTER_API_KEY),
      connected: Boolean(process.env.OPENROUTER_API_KEY),
      label: process.env.OPENROUTER_API_KEY ? "OpenRouter configured" : "OpenRouter key missing",
      model: OPENROUTER_CHAT_MODEL,
      code: process.env.OPENROUTER_API_KEY ? "OPENROUTER_CONFIGURED" : "OPENROUTER_API_KEY_MISSING",
      message: process.env.OPENROUTER_API_KEY
        ? `OpenRouter is configured to use model "${OPENROUTER_CHAT_MODEL}". Use /ai/providers/debug for a live generation check.`
        : "Add OPENROUTER_API_KEY in the backend .env file."
    },
    local: localStatus
  };
}

async function getProviderDebugStatuses() {
  const [gemini, openrouter, local] = await Promise.all([
    liveCheckGemini(),
    liveCheckOpenRouter(),
    liveCheckLocal()
  ]);

  return { gemini, openrouter, local };
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
        code: "OLLAMA_MODEL_MISSING",
        url: OLLAMA_URL,
        model: OLLAMA_MODEL,
        available_models: models.map((model) => model?.name).filter(Boolean),
        message: `Local LLM is reachable at ${OLLAMA_URL}, but model "${OLLAMA_MODEL}" is not installed. Run "ollama pull ${OLLAMA_MODEL}" first.`
      };
    }

    return {
      configured: true,
      connected: true,
      label: "Local LLM connected",
      code: "OLLAMA_CONNECTED",
      url: OLLAMA_URL,
      model: OLLAMA_MODEL,
      available_models: models.map((model) => model?.name).filter(Boolean),
      message: `Local LLM "${OLLAMA_MODEL}" is reachable at ${OLLAMA_URL}.`
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      label: "LLM not connected",
      code: "OLLAMA_UNREACHABLE",
      url: OLLAMA_URL,
      model: OLLAMA_MODEL,
      message: `Could not reach the local LLM at ${OLLAMA_URL}. Start Ollama, then confirm model "${OLLAMA_MODEL}" is installed.`
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
  const provider = String(error?.provider || fallbackProvider || "llm").toLowerCase();
  const model = error?.model ? ` (${error.model})` : "";
  const message = String(error?.message || "").trim();

  if (provider === "local" || provider === "ollama" || fallbackProvider === "local") {
    if (error?.code === "OLLAMA_MODEL_MISSING") {
      return `Local LLM${model} is reachable, but the configured model is not installed. ${message}`;
    }

    if (error?.code === "OLLAMA_UNREACHABLE") {
      return `Local LLM${model} could not be reached. ${message}`;
    }

    if (error?.code === "OLLAMA_TIMEOUT") {
      return `Local LLM${model} timed out while generating a response.`;
    }
  }

  if (provider === "openrouter") {
    if (error?.code === "OPENROUTER_API_KEY_MISSING") {
      return "OpenRouter is not configured. Add OPENROUTER_API_KEY in the backend .env file.";
    }

    if (error?.code === "OPENROUTER_UNAUTHORIZED" || getAxiosStatus(error) === 401) {
      return "OpenRouter rejected the API key. Update OPENROUTER_API_KEY in the backend .env file.";
    }

    if (error?.code === "OPENROUTER_TIMEOUT") {
      return `OpenRouter${model} timed out while generating a response.`;
    }
  }

  if (provider === "gemini") {
    if (error?.code === "GEMINI_API_KEY_MISSING") {
      return "Gemini is not configured. Add GEMINI_API_KEY in the backend .env file.";
    }

    if (error?.code === "GEMINI_MODEL_UNAVAILABLE" || getAxiosStatus(error) === 404) {
      return `Gemini${model} is not available for the configured API key/project. Update GEMINI_TEXT_MODEL to a supported model.`;
    }

    if (error?.code === "GEMINI_TIMEOUT") {
      return `Gemini${model} timed out while generating a response.`;
    }
  }

  if (message) {
    const prefix = provider === "llm" ? "LLM" : `${capitalize(provider)}${model}`;
    return `${prefix} error: ${message}`;
  }

  return "LLM responded with an error.";
}

function normalizeLocalError(error, model) {
  const message = String(error?.response?.data?.error || error?.message || "").toLowerCase();

  if (error?.code === "ECONNREFUSED" || error?.code === "ECONNABORTED" || message.includes("connect")) {
    const connectionError = new Error(`Could not reach Ollama at ${OLLAMA_URL}. Make sure the Ollama app/service is running.`);
    connectionError.code = error?.code === "ECONNABORTED" ? "OLLAMA_TIMEOUT" : "OLLAMA_UNREACHABLE";
    connectionError.provider = "local";
    connectionError.model = model;
    return connectionError;
  }

  if (message.includes("model") && (message.includes("not found") || message.includes("pull"))) {
    const missingModelError = new Error(`Ollama is reachable at ${OLLAMA_URL}, but model "${model}" is not installed. Run "ollama pull ${model}".`);
    missingModelError.code = "OLLAMA_MODEL_MISSING";
    missingModelError.provider = "local";
    missingModelError.model = model;
    return missingModelError;
  }

  error.provider = error.provider || "local";
  error.model = error.model || model;
  return error;
}

function normalizeLocalEmbeddingError(error) {
  const message = String(error?.response?.data?.error || error?.message || "").toLowerCase();

  if (error?.code === "ECONNREFUSED" || error?.code === "ECONNABORTED" || message.includes("connect")) {
    const connectionError = new Error(`Could not reach Ollama embeddings at ${OLLAMA_URL}. Make sure Ollama is running and "${OLLAMA_EMBED_MODEL}" is installed.`);
    connectionError.code = error?.code === "ECONNABORTED" ? "OLLAMA_EMBED_TIMEOUT" : "OLLAMA_UNREACHABLE";
    connectionError.provider = "local";
    connectionError.model = OLLAMA_EMBED_MODEL;
    return connectionError;
  }

  if (message.includes("model") && (message.includes("not found") || message.includes("pull"))) {
    const missingModelError = new Error(`Ollama is reachable at ${OLLAMA_URL}, but embedding model "${OLLAMA_EMBED_MODEL}" is not installed. Run "ollama pull ${OLLAMA_EMBED_MODEL}".`);
    missingModelError.code = "OLLAMA_MODEL_MISSING";
    missingModelError.provider = "local";
    missingModelError.model = OLLAMA_EMBED_MODEL;
    return missingModelError;
  }

  error.provider = error.provider || "local";
  error.model = error.model || OLLAMA_EMBED_MODEL;
  return error;
}

function capitalize(value) {
  const text = String(value || "");
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "LLM";
}

function getAxiosStatus(error) {
  return Number(error?.response?.status || 0) || null;
}

function buildGeminiStatusMessage(error) {
  const status = getAxiosStatus(error);
  if (status === 401 || status === 403) {
    return "Gemini rejected the configured API key.";
  }

  if (status === 404) {
    return `Gemini API is reachable, but model "${GEMINI_TEXT_MODEL}" is not available for this key/project.`;
  }

  return "Could not verify Gemini connectivity.";
}

function buildOpenRouterStatusMessage(error) {
  const status = getAxiosStatus(error);
  if (status === 401 || status === 403) {
    return "OpenRouter rejected the configured API key.";
  }

  return "Could not verify OpenRouter connectivity.";
}

async function liveCheckGemini() {
  if (!process.env.GEMINI_API_KEY) {
    return {
      configured: false,
      connected: false,
      model: GEMINI_TEXT_MODEL,
      code: "GEMINI_API_KEY_MISSING",
      message: "Add GEMINI_API_KEY in the backend .env file."
    };
  }

  try {
    const client = getGeminiClient();
    const model = client.getGenerativeModel({ model: GEMINI_TEXT_MODEL });
    await withTimeout(
      model.generateContent({
        contents: [{ role: "user", parts: [{ text: "Reply with OK." }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 4
        }
      }),
      STATUS_TIMEOUT_MS,
      "GEMINI_TIMEOUT"
    );

    return {
      configured: true,
      connected: true,
      model: GEMINI_TEXT_MODEL,
      code: "GEMINI_CONNECTED",
      message: `Gemini model "${GEMINI_TEXT_MODEL}" completed a live test request.`
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      model: GEMINI_TEXT_MODEL,
      code: error?.code || (getAxiosStatus(error) === 404 ? "GEMINI_MODEL_UNAVAILABLE" : "GEMINI_UNREACHABLE"),
      message: formatProviderError(normalizeProviderError(error, "gemini", GEMINI_TEXT_MODEL), "gemini")
    };
  }
}

async function liveCheckOpenRouter() {
  if (!process.env.OPENROUTER_API_KEY) {
    return {
      configured: false,
      connected: false,
      model: OPENROUTER_CHAT_MODEL,
      code: "OPENROUTER_API_KEY_MISSING",
      message: "Add OPENROUTER_API_KEY in the backend .env file."
    };
  }

  try {
    await withTimeout(
      axios.post(
        `${OPENROUTER_BASE_URL}/chat/completions`,
        {
          model: OPENROUTER_CHAT_MODEL,
          messages: [{ role: "user", content: "Reply with OK." }],
          temperature: 0,
          max_tokens: 4
        },
        {
          timeout: STATUS_TIMEOUT_MS,
          headers: getOpenRouterHeaders()
        }
      ),
      STATUS_TIMEOUT_MS,
      "OPENROUTER_TIMEOUT"
    );

    return {
      configured: true,
      connected: true,
      model: OPENROUTER_CHAT_MODEL,
      code: "OPENROUTER_CONNECTED",
      message: `OpenRouter model "${OPENROUTER_CHAT_MODEL}" completed a live test request.`
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      model: OPENROUTER_CHAT_MODEL,
      code: error?.code || (getAxiosStatus(error) === 401 ? "OPENROUTER_UNAUTHORIZED" : "OPENROUTER_UNREACHABLE"),
      message: formatProviderError(normalizeProviderError(error, "openrouter", OPENROUTER_CHAT_MODEL), "openrouter")
    };
  }
}

async function liveCheckLocal() {
  const status = await getLocalProviderStatus();
  if (!status.connected) {
    return status;
  }

  try {
    await withTimeout(
      axios.post(
        `${OLLAMA_URL}/api/generate`,
        {
          model: OLLAMA_MODEL,
          prompt: "Reply with OK.",
          stream: false,
          options: {
            temperature: 0
          }
        },
        {
          timeout: STATUS_TIMEOUT_MS
        }
      ),
      STATUS_TIMEOUT_MS,
      "OLLAMA_TIMEOUT"
    );

    return {
      ...status,
      code: "OLLAMA_CONNECTED",
      message: `Local LLM "${OLLAMA_MODEL}" completed a live test request at ${OLLAMA_URL}.`
    };
  } catch (error) {
    const normalized = normalizeLocalError(error, OLLAMA_MODEL);
    return {
      configured: true,
      connected: false,
      model: OLLAMA_MODEL,
      url: OLLAMA_URL,
      code: normalized.code || "OLLAMA_UNREACHABLE",
      message: formatProviderError(normalized, "local")
    };
  }
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
  createLocalEmbeddings,
  createRemoteEmbeddings,
  formatProviderError,
  getProviderDebugStatuses,
  generateText,
  getProviderStatuses,
  resolveTextProvider
};
