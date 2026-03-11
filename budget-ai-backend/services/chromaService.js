const axios = require("axios");

const CHROMA_URL = process.env.CHROMA_URL || "http://localhost:8000";
const CHROMA_COLLECTION = process.env.CHROMA_COLLECTION || "budget_reports_embeddings";
const CHROMA_TENANT = process.env.CHROMA_TENANT || "default_tenant";
const CHROMA_DATABASE = process.env.CHROMA_DATABASE || "default_database";
const CHROMA_TIMEOUT_MS = Number(process.env.CHROMA_TIMEOUT_MS || 15000);

const client = axios.create({
  baseURL: CHROMA_URL,
  timeout: CHROMA_TIMEOUT_MS
});

let cachedCollection = null;
let heartbeatChecked = false;

function formatAxiosError(error) {
  if (!error) return "Unknown error";
  const status = error.response?.status;
  const statusText = error.response?.statusText;
  const url = error.config?.baseURL ? `${error.config.baseURL}${error.config.url || ""}` : (error.config?.url || "");
  const message = error.message || String(error);
  return [status ? `HTTP ${status}${statusText ? ` ${statusText}` : ""}` : null, url || null, message].filter(Boolean).join(" | ");
}

async function ensureChromaReachable() {
  if (heartbeatChecked) return;
  heartbeatChecked = true;

  const tryHeartbeat = async (baseURL) => {
    const response = await client.get(`/api/v2/heartbeat`, { baseURL });
    return response?.status === 200;
  };

  const tried = [];
  const base = client.defaults.baseURL || CHROMA_URL;

  try {
    tried.push(base);
    await tryHeartbeat(base);
    return;
  } catch (_error) {
    // Attempt auto-discovery on localhost to avoid common port misconfiguration (e.g. backend also on 8000).
  }

  const candidates = [];
  try {
    const u = new URL(String(base));
    const isLocal = ["localhost", "127.0.0.1"].includes(u.hostname);
    if (isLocal) {
      const portsToTry = [8000, 8001, 8002, 8003];
      for (const p of portsToTry) {
        const candidate = `${u.protocol}//${u.hostname}:${p}`;
        if (candidate !== base) candidates.push(candidate);
      }
    }
  } catch (_e) {
    // ignore URL parse failure
  }

  for (const candidate of candidates) {
    try {
      tried.push(candidate);
      await tryHeartbeat(candidate);
      client.defaults.baseURL = candidate;
      console.log("[Chroma] auto_discovered_base_url", { baseURL: candidate });
      return;
    } catch (_error) {
      // continue
    }
  }

  const details = `Tried: ${tried.join(", ")}`;
  const hint = `Chroma is not reachable. Start Chroma and set CHROMA_URL to the correct address (for example: http://localhost:8001).`;
  const e = new Error(`${hint} (${details})`);
  e.code = "CHROMA_UNREACHABLE";
  throw e;
}

async function ensureCollection() {
  if (cachedCollection) return cachedCollection;

  await ensureChromaReachable();

  const basePath = `/api/v2/tenants/${encodeURIComponent(CHROMA_TENANT)}/databases/${encodeURIComponent(CHROMA_DATABASE)}`;
  const collectionsPath = `${basePath}/collections`;

  const getCollectionByName = async () => {
    try {
      const response = await client.get(`${collectionsPath}/${encodeURIComponent(CHROMA_COLLECTION)}`);
      return response?.data || null;
    } catch (error) {
      if (error?.response?.status === 404) {
        return null;
      }
      throw error;
    }
  };

  const findCollectionByName = async () => {
    const existing = await client.get(collectionsPath, { params: { limit: 100, offset: 0 } });
    const list = existing.data?.value || existing.data?.collections || existing.data?.items || [];
    return Array.isArray(list) ? list.find((c) => c?.name === CHROMA_COLLECTION) : null;
  };

  // Prefer direct lookup by name when supported.
  try {
    const direct = await getCollectionByName();
    if (direct) {
      cachedCollection = direct;
      return cachedCollection;
    }
  } catch (error) {
    const details = formatAxiosError(error);
    const hint = `Failed to fetch Chroma collection "${CHROMA_COLLECTION}" at CHROMA_URL="${client.defaults.baseURL || CHROMA_URL}".`;
    const e = new Error(`${hint} (${details})`);
    e.code = "CHROMA_COLLECTION_GET_FAILED";
    throw e;
  }

  // Look up existing collections and match by name.
  try {
    const found = await findCollectionByName();
    if (found) {
      cachedCollection = found;
      return cachedCollection;
    }
  } catch (error) {
    const details = formatAxiosError(error);
    const hint = `Failed to list Chroma collections at CHROMA_URL="${client.defaults.baseURL || CHROMA_URL}".`;
    const e = new Error(`${hint} (${details})`);
    e.code = "CHROMA_COLLECTION_LIST_FAILED";
    throw e;
  }

  let created;
  try {
    created = await client.post(collectionsPath, {
      name: CHROMA_COLLECTION,
      metadata: { source: "budget-ai" }
    });
  } catch (error) {
    if (error?.response?.status === 409) {
      try {
        const found = await getCollectionByName() || await findCollectionByName();
        if (found) {
          cachedCollection = found;
          return cachedCollection;
        }
      } catch (_innerError) {
        // fall through to throw original create error
      }
    }
    const details = formatAxiosError(error);
    const hint = `Failed to create Chroma collection "${CHROMA_COLLECTION}" at CHROMA_URL="${client.defaults.baseURL || CHROMA_URL}".`;
    const e = new Error(`${hint} (${details})`);
    e.code = "CHROMA_COLLECTION_CREATE_FAILED";
    throw e;
  }

  cachedCollection = created.data;
  return cachedCollection;
}

async function addDocuments({ ids, embeddings, documents, metadatas }) {
  const collection = await ensureCollection();
  const basePath = `/api/v2/tenants/${encodeURIComponent(CHROMA_TENANT)}/databases/${encodeURIComponent(CHROMA_DATABASE)}`;

  await client.post(`${basePath}/collections/${encodeURIComponent(collection.id)}/add`, {
    ids,
    embeddings,
    documents,
    metadatas
  });
}

async function queryCollection({ embeddings, nResults = 4, where = null }) {
  const collection = await ensureCollection();
  const basePath = `/api/v2/tenants/${encodeURIComponent(CHROMA_TENANT)}/databases/${encodeURIComponent(CHROMA_DATABASE)}`;

  const payload = {
    query_embeddings: embeddings,
    n_results: nResults,
    include: ["documents", "metadatas", "distances"]
  };

  if (where) {
    payload.where = where;
  }

  const response = await client.post(`${basePath}/collections/${encodeURIComponent(collection.id)}/query`, payload);

  return response.data;
}

module.exports = {
  addDocuments,
  queryCollection,
  deleteDocuments
};

async function deleteDocuments({ ids }) {
  const collection = await ensureCollection();
  const basePath = `/api/v2/tenants/${encodeURIComponent(CHROMA_TENANT)}/databases/${encodeURIComponent(CHROMA_DATABASE)}`;

  await client.post(`${basePath}/collections/${encodeURIComponent(collection.id)}/delete`, {
    ids
  });
}
