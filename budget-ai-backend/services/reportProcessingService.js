const { formatProviderError, generateText } = require("./aiProviderService");
const { buildBudgetSummaryPrompt, buildFallbackSummary, parseBudgetSummary } = require("./reportPromptService");
const { getReportById, updateReportIndexState, updateReportSummaryState } = require("./reportService");
const { indexReport } = require("./ragService");

const inFlightJobs = new Map();

function enqueueReportProcessing({ reportId, modelChoice }) {
  const safeId = Number(reportId);
  if (!safeId || inFlightJobs.has(safeId)) return;

  const job = processReport(safeId, modelChoice)
    .catch((error) => {
      console.error("[REPORT_PROCESSING_FAILED]", safeId, error);
    })
    .finally(() => {
      inFlightJobs.delete(safeId);
    });

  inFlightJobs.set(safeId, job);
}

async function processReport(reportId, modelChoice) {
  const report = await getReportById(reportId);
  if (!report) return;

  await processSummary(report, modelChoice);

  const latestReport = await getReportById(reportId);
  if (!latestReport) return;

  await processIndexing(latestReport);
}

async function processSummary(report, modelChoice) {
  await updateReportSummaryState(report.id, {
    ai_summary_status: "processing",
    ai_summary_error: null
  });

  const fallback = buildFallbackSummary(report);

  try {
    const result = await generateText({
      modelChoice,
      prompt: buildBudgetSummaryPrompt(report),
      temperature: 0.35
    });
    const parsed = parseBudgetSummary(result.text);

    await updateReportSummaryState(report.id, {
      ai_summary_status: "ready",
      ai_summary_error: null,
      ai_summary: parsed.summary || fallback.summary,
      ai_recommendations: (parsed.recommendations || fallback.recommendations).join("\n"),
      llm_provider: result.provider
    });
  } catch (error) {
    await updateReportSummaryState(report.id, {
      ai_summary_status: "failed",
      ai_summary_error: formatProviderError(error, modelChoice),
      ai_summary: fallback.summary,
      ai_recommendations: fallback.recommendations.join("\n")
    });
  }
}

async function processIndexing(report) {
  await updateReportIndexState(report.id, {
    index_status: "processing",
    index_error: null
  });

  try {
    const result = await indexReport(report);
    await updateReportIndexState(report.id, {
      index_status: "ready",
      index_error: null,
      embedding_provider: result.embeddingProvider
    });
  } catch (error) {
    await updateReportIndexState(report.id, {
      index_status: "failed",
      index_error: formatProcessingError(error)
    });
  }
}

function formatProcessingError(error) {
  if (!error) return "Unknown error";
  const status = error.response?.status;
  const message = error.response?.data?.error?.message || error.message || String(error);
  return [status ? `HTTP ${status}` : null, message].filter(Boolean).join(" - ");
}

module.exports = {
  enqueueReportProcessing
};
