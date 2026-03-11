const { generateGeminiAdvice } = require("../services/geminiService");
const { generateLocalResponse } = require("../services/localLlmService");
const { answerWithRag } = require("../services/ragService");

async function chatAssistant(req, res) {
  const message = String(req.body?.message || "").trim();
  const model = String(req.body?.model || "gemini").toLowerCase();

  if (!message) {
    return res.status(400).json({ message: "message is required" });
  }

  const prompt = `You are an AI budget assistant. Answer the user question clearly and briefly.\n\nUser question: ${message}`;
  let response;

  const normalized = String(model || "gemini").toLowerCase();

  if (normalized === "local" || normalized === "ollama" || normalized === "llama") {
    try {
      response = await generateLocalResponse(prompt, { temperature: 0.3, top_p: 0.9 });
    } catch (_error) {
      response = null;
    }
  }

  if (!response) {
    try {
      response = await generateGeminiAdvice(prompt);
    } catch (_error) {
      try {
        response = await generateLocalResponse(prompt, { temperature: 0.3, top_p: 0.9 });
      } catch (_innerError) {
        response = "AI assistant is temporarily unavailable. Please try again in a moment.";
      }
    }
  }

  return res.json({ response });
}

async function ragAssistant(req, res) {
  const message = String(req.body?.message || "").trim();
  const attachedReportId = req.body?.attached_report_id || req.body?.report_id || null;
  const attachedMonth = req.body?.attached_month || null;
  const attachedYear = req.body?.attached_year || null;
  const model = String(req.body?.model || "gemini").toLowerCase();

  if (!message) {
    return res.status(400).json({ message: "message is required" });
  }

  const result = await answerWithRag({
    message,
    attachedReportId,
    attachedMonth,
    attachedYear,
    model
  });
  if (attachedReportId && result?.error === "REPORT_NOT_INDEXED") {
    return res.status(409).json(result);
  }
  return res.json(result);
}

module.exports = {
  chatAssistant,
  ragAssistant
};
