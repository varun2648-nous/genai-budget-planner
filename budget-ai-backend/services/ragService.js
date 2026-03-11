const { createEmbedding, createEmbeddings } = require("./embeddingService");
const { addDocuments, queryCollection, deleteDocuments } = require("./chromaService");
const { formatProviderError, generateText } = require("./aiProviderService");
const { getPool } = require("../config/database");
const { buildReportChunks } = require("./reportChunkService");
const { buildGeneralChatPrompt, buildRagChatPrompt } = require("./reportPromptService");

const TOP_K = Number(process.env.RAG_TOP_K || 4);

async function indexReport(report) {
  if (!report) {
    return { embeddingProvider: "none" };
  }

  const chunks = buildReportChunks(report);
  if (!chunks.length) {
    return { embeddingProvider: "none" };
  }

  const embeddingResult = await createEmbeddings(chunks.map((chunk) => chunk.document));
  await deleteDocuments({ where: { reportId: Number(report.id) } }).catch(() => {});

  await addDocuments({
    ids: chunks.map((chunk) => chunk.id),
    embeddings: embeddingResult.embeddings,
    documents: chunks.map((chunk) => chunk.document),
    metadatas: chunks.map((chunk) => chunk.metadata)
  });

  return {
    embeddingProvider: embeddingResult.provider
  };
}

async function answerWithRag({ message, attachedReportId, attachedMonth, attachedYear, model }) {
  try {
    const trimmedMessage = String(message || "").trim();
    if (!trimmedMessage) {
      return { response: "", context_used: false, chunks_used: 0 };
    }

    if (!attachedReportId) {
      const prompt = buildGeneralChatPrompt(trimmedMessage);
      const text = await generateChatResponse({ model, prompt });
      return { response: text, context_used: false, chunks_used: 0 };
    }

    const report = await getReportForIndexing(Number(attachedReportId));
    if (!report) {
      return {
        response: "The selected report could not be found.",
        context_used: false,
        chunks_used: 0,
        error: "REPORT_NOT_FOUND"
      };
    }

    if (report.index_status !== "ready") {
      return {
        response: report.index_status === "failed"
          ? "The attached report could not be prepared for AI chat. Please regenerate it after fixing the vector-store configuration."
          : "The attached report is still being prepared for AI chat. Please wait until preprocessing finishes.",
        context_used: false,
        chunks_used: 0,
        error: "REPORT_NOT_INDEXED",
        index_status: report.index_status
      };
    }

    const queryEmbedding = await createEmbedding(trimmedMessage);
    const filter = buildFilter({ attachedReportId, attachedMonth, attachedYear });
    const results = await queryCollection({
      embeddings: [queryEmbedding],
      nResults: TOP_K,
      where: filter
    });
    const documents = (results?.documents?.[0] || []).filter(Boolean);
    const metadatas = results?.metadatas?.[0] || [];

    if (!documents.length) {
      return {
        response: "The attached report is marked ready, but no indexed chunks were found. Please regenerate the report to rebuild its knowledge base.",
        context_used: false,
        chunks_used: 0,
        error: "REPORT_NOT_INDEXED"
      };
    }

    const contexts = documents.map((document, index) => ({
      document,
      metadata: metadatas[index] || {}
    }));
    const prompt = buildRagChatPrompt({
      message: trimmedMessage,
      reportName: report.report_name,
      contexts
    });
    const text = await generateChatResponse({ model, prompt });

    return {
      response: text,
      context_used: true,
      chunks_used: documents.length
    };
  } catch (_error) {
    if (attachedReportId) {
      return {
        response: "The report-aware assistant hit a retrieval error. Please try again in a moment.",
        context_used: false,
        chunks_used: 0,
        error: "RAG_PIPELINE_FAILED"
      };
    }

    const prompt = buildGeneralChatPrompt(message);
    const text = await generateChatResponse({ model, prompt });
    return { response: text, context_used: false, chunks_used: 0 };
  }
}

function buildFilter({ attachedReportId, attachedMonth, attachedYear }) {
  if (attachedReportId) {
    return { reportId: Number(attachedReportId) };
  }

  if (attachedMonth && attachedYear) {
    return { month: attachedMonth, year: Number(attachedYear) };
  }

  return null;
}

function isTimeoutError(error) {
  if (!error) return false;
  const code = error.code || error?.response?.code;
  const message = String(error.message || "").toLowerCase();
  return code === "LLM_TIMEOUT" || code === "ECONNABORTED" || message.includes("timeout");
}

async function generateChatResponse({ model, prompt }) {
  try {
    const result = await generateText({
      modelChoice: model,
      prompt,
      temperature: 0.3
    });
    return result.text;
  } catch (error) {
    if (isTimeoutError(error)) {
      return formatProviderError({
        ...error,
        message: `Request timed out while waiting for the selected model.`
      }, model);
    }
    return formatProviderError(error, model);
  }
}

async function getReportForIndexing(reportId) {
  if (!reportId) return null;

  const pool = getPool();
  const [rows] = await pool.execute(`SELECT * FROM reports WHERE id = ?`, [Number(reportId)]);
  const row = rows?.[0];
  if (!row) return null;

  return {
    ...row,
    input: row.input_json ? JSON.parse(row.input_json) : null,
    metrics: row.metrics_json && typeof row.metrics_json === "string"
      ? JSON.parse(row.metrics_json)
      : row.metrics_json,
    report_name: `${row.month} ${row.year} — Report ${row.report_index}`
  };
}

async function deleteReportEmbeddings(reportId) {
  if (!reportId) return;

  try {
    await deleteDocuments({ where: { reportId: Number(reportId) } });
  } catch (_error) {
    // Ignore delete failures; database deletion still succeeds.
  }
}

module.exports = {
  answerWithRag,
  deleteReportEmbeddings,
  indexReport
};
