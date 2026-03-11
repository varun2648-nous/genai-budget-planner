const { createRemoteEmbeddings } = require("./aiProviderService");
const { asNumber } = require("./reportServiceUtils");

const FALLBACK_DIMENSION = asNumber(process.env.FALLBACK_EMBED_DIM || 256) || 256;

async function createEmbeddings(texts) {
  const safeTexts = Array.isArray(texts) ? texts : [];

  try {
    return await createRemoteEmbeddings(safeTexts);
  } catch (_error) {
    return {
      embeddings: safeTexts.map((text) => makeFallbackEmbedding(text, FALLBACK_DIMENSION)),
      provider: "deterministic-fallback",
      model: "hash-embedding"
    };
  }
}

async function createEmbedding(text) {
  const result = await createEmbeddings([text]);
  return result.embeddings[0];
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
  createEmbedding,
  createEmbeddings
};
