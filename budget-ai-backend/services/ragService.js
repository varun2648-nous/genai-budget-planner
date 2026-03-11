const { createEmbedding } = require("./embeddingService");
const { addDocuments, queryCollection, deleteDocuments } = require("./chromaService");
const { generateGeminiAdvice } = require("./geminiService");
const { generateLocalResponse } = require("./localLlmService");
const { getPool } = require("../config/database");

const TOP_K = Number(process.env.RAG_TOP_K || 5);

async function indexReport(report) {
  if (!report) return;

  const chunks = buildReportChunks(report);
  const embeddings = [];

  for (const chunk of chunks) {
    // eslint-disable-next-line no-await-in-loop
    embeddings.push(await createEmbedding(chunk.document));
  }

  // Make indexing idempotent: ensure old versions are removed first.
  try {
    await deleteDocuments({ ids: chunks.map((chunk) => chunk.id) });
  } catch (_error) {
    // Ignore delete failures; collection may not have these ids yet.
  }

  await addDocuments({
    ids: chunks.map((chunk) => chunk.id),
    embeddings,
    documents: chunks.map((chunk) => chunk.document),
    metadatas: chunks.map((chunk) => chunk.metadata)
  });
}

async function answerWithRag({ message, attachedReportId, attachedMonth, attachedYear, model }) {
  try {
    const totalReports = await getTotalReports();
    if (totalReports === 0) {
      const generalPrompt = buildGeneralPrompt(message);
      const text = await generateChatResponse({ model, prompt: generalPrompt });
      return { response: text, context_used: false, chunks_used: 0 };
    }

    const shouldRetrieve = shouldUseRetrieval(message, attachedReportId);

    if (!shouldRetrieve) {
      const generalPrompt = buildGeneralPrompt(message);
      const text = await generateChatResponse({ model, prompt: generalPrompt });
      return { response: text, context_used: false, chunks_used: 0 };
    }

    console.log("[RAG] retrieval_start", {
      attachedReportId: attachedReportId || null,
      attachedMonth: attachedMonth || null,
      attachedYear: attachedYear || null,
      topK: TOP_K
    });

    const queryEmbedding = await createEmbedding(message);
    const filter = buildFilter({ attachedReportId, attachedMonth, attachedYear });
    let results = await queryCollection({ embeddings: [queryEmbedding], nResults: TOP_K, where: filter });
    const documents = (results?.documents?.[0] || []).filter(Boolean);
    const metadatas = results?.metadatas?.[0] || [];

    if (!documents.length) {
      // If a report is attached, retrieval is mandatory: try to (re)index once, then fail loudly.
      if (attachedReportId) {
        // Backward compatibility: older indexed chunks used report_id (snake_case).
        // Try a legacy-filter query once; if it returns, reindex to new reportId key and proceed.
        const legacyFilter = { report_id: Number(attachedReportId) };
        try {
          const legacyResults = await queryCollection({ embeddings: [queryEmbedding], nResults: TOP_K, where: legacyFilter });
          const legacyDocs = (legacyResults?.documents?.[0] || []).filter(Boolean);
          const legacyMetas = legacyResults?.metadatas?.[0] || [];
          if (legacyDocs.length) {
            console.log("[RAG] legacy_filter_hit_reindexing", { attachedReportId: Number(attachedReportId) });
            const legacyContextBlock = legacyDocs.map((doc, idx) => {
              const meta = legacyMetas[idx] || {};
              const label = meta.chunk_type ? `${meta.chunk_type}` : `chunk ${idx + 1}`;
              return `Context ${idx + 1} (${label}):\n${doc}`;
            }).join("\n\n");

            const legacyPrompt = `You are an AI budget assistant. You MUST ground your answer in the historical report context.

User question: ${message}

Historical context:\n${legacyContextBlock}

Rules:
- Use only numbers and facts present in the context.
- If a value is not in the context, say it is not available in the attached report.
- Prefer quoting exact rupee amounts and percentages from the context.`;

            // Best-effort reindex to new metadata key so next query uses the correct filter.
            const report = await getReportForIndexing(Number(attachedReportId));
            if (report) {
              try {
                await indexReport(report);
              } catch (_error) {
                // ignore
              }
            }

            const legacyText = await generateChatResponse({ model, prompt: legacyPrompt });
            console.log("[RAG] retrieval_end", {
              attachedReportId: Number(attachedReportId),
              filter: legacyFilter,
              chunksUsed: legacyDocs.length
            });
            return { response: legacyText, context_used: true, chunks_used: legacyDocs.length };
          }
        } catch (_error) {
          // Ignore and proceed to retry indexing flow.
        }

        console.log("[RAG] retrieval_empty_retry_index", {
          attachedReportId: Number(attachedReportId),
          filter
        });

        const report = await getReportForIndexing(Number(attachedReportId));
        if (report) {
          try {
            await indexReport(report);
          } catch (error) {
            console.log("[RAG] index_retry_failed", { attachedReportId: Number(attachedReportId), error: String(error?.message || error) });
          }
        }

        results = await queryCollection({ embeddings: [queryEmbedding], nResults: TOP_K, where: filter });
        const retryDocs = (results?.documents?.[0] || []).filter(Boolean);
        const retryMetas = results?.metadatas?.[0] || [];

        console.log("[RAG] retrieval_end", {
          attachedReportId: Number(attachedReportId),
          filter,
          chunksUsed: retryDocs.length
        });

        if (!retryDocs.length) {
          return {
            response: "That report is attached, but I couldn't retrieve any indexed context for it. Please re-generate the report or re-index it, then try again.",
            context_used: false,
            chunks_used: 0,
            error: "REPORT_NOT_INDEXED"
          };
        }

        const retryContextBlock = retryDocs.map((doc, idx) => {
          const meta = retryMetas[idx] || {};
          const label = meta.chunk_type ? `${meta.chunk_type}` : `chunk ${idx + 1}`;
          return `Context ${idx + 1} (${label}):\n${doc}`;
        }).join("\n\n");

        const retryPrompt = `You are an AI budget assistant. You MUST ground your answer in the historical report context.

User question: ${message}

Historical context:\n${retryContextBlock}

Rules:
- Use only numbers and facts present in the context.
- If a value is not in the context, say it is not available in the attached report.
- Prefer quoting exact rupee amounts and percentages from the context.

Provide a concise, data-driven response. Include any comparisons or trends that are supported by the context.`;

        const retryText = await generateChatResponse({ model, prompt: retryPrompt });
        return { response: retryText, context_used: true, chunks_used: retryDocs.length };
      }

      const generalPrompt = buildGeneralPrompt(message);
      const text = await generateChatResponse({ model, prompt: generalPrompt });
      return { response: text, context_used: false, chunks_used: 0 };
    }

    console.log("[RAG] retrieval_end", {
      attachedReportId: attachedReportId ? Number(attachedReportId) : null,
      filter,
      chunksUsed: documents.length
    });

    const contextBlock = documents.map((doc, idx) => {
      const meta = metadatas[idx] || {};
      const label = meta.chunk_type ? `${meta.chunk_type}` : `chunk ${idx + 1}`;
      return `Context ${idx + 1} (${label}):\n${doc}`;
    }).join("\n\n");

    const prompt = `You are an AI budget assistant. You MUST ground your answer in the historical report context.

User question: ${message}

Historical context:\n${contextBlock}

Rules:
- Use only numbers and facts present in the context.
- If a value is not in the context, say it is not available in the attached report.
- Prefer quoting exact rupee amounts and percentages from the context.

Provide a concise, data-driven response. Include any comparisons or trends that are supported by the context.`;

    const text = await generateChatResponse({ model, prompt });
    return { response: text, context_used: true, chunks_used: documents.length };
  } catch (_error) {
    // Never return a generic answer when the user explicitly attached a report.
    if (attachedReportId) {
      console.log("[RAG] retrieval_failed", {
        attachedReportId: Number(attachedReportId),
        error: String(_error?.message || _error),
        code: _error?.code || null
      });
      return {
        response: "A report is attached, but the retrieval pipeline failed. Please try again in a moment; if it persists, re-index the report and retry.",
        context_used: false,
        chunks_used: 0,
        error: "RAG_PIPELINE_FAILED"
      };
    }

    const fallbackPrompt = buildGeneralPrompt(message);
    const text = await generateChatResponse({ model, prompt: fallbackPrompt });
    return { response: text, context_used: false, chunks_used: 0 };
  }
}

function buildReportChunks(report) {
  const name = report.report_name || `${report.month} ${report.year} - Report ${report.report_index}`;
  const baseMeta = {
    // IMPORTANT: must match Chroma filter key for attached-report retrieval.
    reportId: report.id,
    // Keep legacy key for backward compatibility with already-indexed chunks.
    report_id: report.id,
    month: report.month,
    year: report.year,
    report_index: report.report_index
  };

  const inputs = report.input || {};
  const fixed = inputs.fixed_expenses_breakdown || {};
  const variable = inputs.variable_expenses_breakdown || {};

  return [
    {
      id: `${report.id}-chunk-1`,
      document: [
        `Report: ${name}`,
        `Month: ${report.month}`,
        `Year: ${report.year}`,
        `Report Index: ${report.report_index}`
      ].join("\n"),
      metadata: { ...baseMeta, chunk_type: "metadata" }
    },
    {
      id: `${report.id}-chunk-2`,
      document: [
        `Inputs`,
        `Income: ${report.income}`,
        `Savings Goal: ${inputs.savings_goal || 0}`,
        `Fixed Breakdown: ${JSON.stringify(fixed)}`,
        `Variable Breakdown: ${JSON.stringify(variable)}`
      ].join("\n"),
      metadata: { ...baseMeta, chunk_type: "inputs" }
    },
    {
      id: `${report.id}-chunk-3`,
      document: [
        `Metrics`,
        `Fixed Expenses: ${report.fixed_expenses}`,
        `Variable Expenses: ${report.variable_expenses}`,
        `Savings Rate: ${report.savings_rate}%`,
        `Expense Ratio: ${report.expense_ratio}%`,
        `Emergency Fund Months: ${report.emergency_fund_months}`,
        `Discretionary Ratio: ${report.discretionary_ratio}%`
      ].join("\n"),
      metadata: { ...baseMeta, chunk_type: "metrics" }
    },
    {
      id: `${report.id}-chunk-4`,
      document: [
        `AI Summary`,
        report.ai_summary || ""
      ].join("\n"),
      metadata: { ...baseMeta, chunk_type: "summary" }
    },
    {
      id: `${report.id}-chunk-5`,
      document: [
        `AI Recommendations`,
        report.ai_recommendations || ""
      ].join("\n"),
      metadata: { ...baseMeta, chunk_type: "recommendations" }
    }
  ];
}

function buildFilter({ attachedReportId, attachedMonth, attachedYear }) {
  if (attachedReportId) {
    // Filter key must match metadata key stored on chunks.
    return { reportId: Number(attachedReportId) };
  }
  if (attachedMonth && attachedYear) {
    return { month: attachedMonth, year: Number(attachedYear) };
  }
  return null;
}

function buildGeneralPrompt(message) {
  return `You are an AI budget assistant. Answer the user question clearly and briefly.\n\nUser question: ${message}`;
}

function shouldUseRetrieval(message, attachedReportId) {
  // If a report is attached, retrieval is mandatory.
  if (attachedReportId) return true;
  const lower = String(message || "").toLowerCase();
  const keywords = ["compare", "trend", "previous", "difference", "history", "overall", "across", "last month", "last year"]; 
  if (keywords.some((keyword) => lower.includes(keyword))) return true;
  if (/\\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\\b/i.test(message)) return true;
  if (/\\b(20\\d{2})\\b/.test(message)) return true;
  return false;
}

function isTimeoutError(error) {
  if (!error) return false;
  const code = error.code || error?.response?.code;
  const message = String(error.message || "").toLowerCase();
  return code === "LLM_TIMEOUT" || code === "ECONNABORTED" || message.includes("timeout");
}

async function generateChatResponse({ model, prompt }) {
  const normalized = String(model || "gemini").toLowerCase();

  if (normalized === "local" || normalized === "ollama" || normalized === "llama") {
    try {
      return await generateLocalResponse(prompt, { temperature: 0.3, top_p: 0.9 });
    } catch (_error) {
      try {
        return await generateGeminiAdvice(prompt);
      } catch (_innerError) {
        if (isTimeoutError(_error) || isTimeoutError(_innerError)) {
          return "The AI model is taking longer than expected. Please try again in a moment, or switch to a faster model.";
        }
        return "AI assistant is temporarily unavailable. Please try again in a moment.";
      }
    }
  }

  try {
    return await generateGeminiAdvice(prompt);
  } catch (_error) {
    try {
      return await generateLocalResponse(prompt, { temperature: 0.3, top_p: 0.9 });
    } catch (_innerError) {
      if (isTimeoutError(_error) || isTimeoutError(_innerError)) {
        return "The AI model is taking longer than expected. Please try again in a moment, or switch to a faster model.";
      }
      return "AI assistant is temporarily unavailable. Please try again in a moment.";
    }
  }
}

async function getTotalReports() {
  const pool = getPool();
  const [rows] = await pool.execute(`SELECT COUNT(*) AS total FROM reports`);
  return Number(rows?.[0]?.total || 0);
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
    metrics: row.metrics_json && typeof row.metrics_json === "string" ? JSON.parse(row.metrics_json) : row.metrics_json,
    report_name: `${row.month} ${row.year} — Report ${row.report_index}`
  };
}

module.exports = {
  indexReport,
  answerWithRag,
  deleteReportEmbeddings
};

async function deleteReportEmbeddings(reportId) {
  if (!reportId) return;
  const ids = Array.from({ length: 5 }, (_, idx) => `${reportId}-chunk-${idx + 1}`);
  try {
    await deleteDocuments({ ids });
  } catch (_error) {
    // Ignore delete failures; database deletion still succeeds.
  }
}
