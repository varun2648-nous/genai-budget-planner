const axios = require("axios");
const { asNumber } = require("./reportServiceUtils");

const OLLAMA_URL = process.env.OLLAMA_URL || process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
const FALLBACK_DIMENSION = asNumber(process.env.FALLBACK_EMBED_DIM || 256) || 256;
const EMBED_TIMEOUT_MS = asNumber(process.env.EMBED_TIMEOUT_MS || 15000) || 15000;

let embeddingUnavailable = false;

async function createEmbedding(text) {
  if (embeddingUnavailable) {
    return makeFallbackEmbedding(text, FALLBACK_DIMENSION);
  }

  try {
    const response = await axios.post(
      `${OLLAMA_URL}/api/embeddings`,
      {
        model: OLLAMA_EMBED_MODEL,
        prompt: text
      },
      { timeout: EMBED_TIMEOUT_MS }
    );

    const embedding = response.data?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error("Invalid embedding response from Ollama");
    }

    return embedding;
  } catch (_error) {
    embeddingUnavailable = true;
    return makeFallbackEmbedding(text, FALLBACK_DIMENSION);
  }
}

function makeFallbackEmbedding(text, dimension) {
  const vector = Array(dimension).fill(0);
  const tokens = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  for (const token of tokens) {
    let hash = 0;
    for (let i = 0; i < token.length; i += 1) {
      hash = (hash * 31 + token.charCodeAt(i)) % 2147483647;
    }
    vector[hash % dimension] += 1;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return vector;

  return vector.map((value) => value / norm);
}

module.exports = {
  createEmbedding
};
