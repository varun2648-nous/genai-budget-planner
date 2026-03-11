const fs = require("fs/promises");
const path = require("path");

const CHROMA_COLLECTION = process.env.CHROMA_COLLECTION || "budget_reports_embeddings";
const CHROMA_DIRECTORY = path.resolve(__dirname, "..", "..", "chroma");
const COLLECTION_FILE = path.join(CHROMA_DIRECTORY, `${CHROMA_COLLECTION}.json`);

let cachedCollection = null;

async function ensureCollection() {
  if (cachedCollection) {
    return cachedCollection;
  }

  await fs.mkdir(CHROMA_DIRECTORY, { recursive: true });

  try {
    const raw = await fs.readFile(COLLECTION_FILE, "utf8");
    cachedCollection = parseCollection(raw);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw wrapStoreError(error, "CHROMA_COLLECTION_LOAD_FAILED", "Failed to load the embedded Chroma collection.");
    }

    cachedCollection = createEmptyCollection();
    await persistCollection();
  }

  return cachedCollection;
}

async function addDocuments({ ids, embeddings, documents, metadatas }) {
  const collection = await ensureCollection();
  const safeIds = Array.isArray(ids) ? ids : [];
  const safeEmbeddings = Array.isArray(embeddings) ? embeddings : [];
  const safeDocuments = Array.isArray(documents) ? documents : [];
  const safeMetadatas = Array.isArray(metadatas) ? metadatas : [];

  for (let index = 0; index < safeIds.length; index += 1) {
    const id = String(safeIds[index] || "").trim();
    const embedding = safeEmbeddings[index];
    if (!id || !Array.isArray(embedding)) {
      continue;
    }

    collection.items[id] = {
      id,
      embedding: embedding.map((value) => Number(value) || 0),
      document: String(safeDocuments[index] || ""),
      metadata: normalizeMetadata(safeMetadatas[index])
    };
  }

  await persistCollection();
}

async function queryCollection({ embeddings, nResults = 4, where = null }) {
  const collection = await ensureCollection();
  const queries = Array.isArray(embeddings) ? embeddings.filter(Array.isArray) : [];
  const items = Object.values(collection.items).filter((item) => matchesWhere(item.metadata, where));

  const documents = [];
  const metadatas = [];
  const distances = [];

  for (const queryEmbedding of queries) {
    const ranked = items
      .map((item) => ({
        item,
        distance: cosineDistance(queryEmbedding, item.embedding)
      }))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, Math.max(0, Number(nResults) || 0));

    documents.push(ranked.map((entry) => entry.item.document));
    metadatas.push(ranked.map((entry) => entry.item.metadata));
    distances.push(ranked.map((entry) => entry.distance));
  }

  return {
    documents,
    metadatas,
    distances
  };
}

async function deleteDocuments({ ids, where }) {
  const collection = await ensureCollection();

  if (Array.isArray(ids) && ids.length) {
    for (const id of ids) {
      delete collection.items[String(id)];
    }
  }

  if (where && typeof where === "object") {
    for (const item of Object.values(collection.items)) {
      if (matchesWhere(item.metadata, where)) {
        delete collection.items[item.id];
      }
    }
  }

  await persistCollection();
}

function createEmptyCollection() {
  return {
    name: CHROMA_COLLECTION,
    storage: "embedded-json",
    items: {}
  };
}

function parseCollection(raw) {
  const parsed = JSON.parse(raw);
  return {
    name: parsed?.name || CHROMA_COLLECTION,
    storage: parsed?.storage || "embedded-json",
    items: parsed?.items && typeof parsed.items === "object" ? parsed.items : {}
  };
}

async function persistCollection() {
  try {
    await fs.writeFile(COLLECTION_FILE, JSON.stringify(cachedCollection, null, 2), "utf8");
  } catch (error) {
    throw wrapStoreError(error, "CHROMA_COLLECTION_SAVE_FAILED", "Failed to persist the embedded Chroma collection.");
  }
}

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, normalizeScalar(value)])
  );
}

function normalizeScalar(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "boolean" || value === null) {
    return value;
  }

  return String(value);
}

function matchesWhere(metadata, where) {
  if (!where || typeof where !== "object") {
    return true;
  }

  return Object.entries(where).every(([key, value]) => metadata?.[key] === value);
}

function cosineDistance(left, right) {
  const maxLength = Math.max(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = Number(left[index] || 0);
    const rightValue = Number(right[index] || 0);
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (!leftNorm || !rightNorm) {
    return 1;
  }

  return 1 - (dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)));
}

function wrapStoreError(error, code, message) {
  const wrapped = new Error(`${message} ${error.message || String(error)}`.trim());
  wrapped.code = code;
  wrapped.cause = error;
  return wrapped;
}

module.exports = {
  addDocuments,
  deleteDocuments,
  queryCollection
};
