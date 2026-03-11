const { formatProviderError, generateText, getProviderStatuses } = require("../services/aiProviderService");
const { answerWithRag } = require("../services/ragService");
const { buildGeneralChatPrompt } = require("../services/reportPromptService");

async function chatAssistant(req, res) {
  const message = String(req.body?.message || "").trim();
  const model = String(req.body?.model || "gemini").toLowerCase();

  if (!message) {
    return res.status(400).json({ message: "message is required" });
  }

  let response;

  try {
    const result = await generateText({
      modelChoice: model,
      prompt: buildGeneralChatPrompt(message),
      temperature: 0.3
    });
    response = result.text;
  } catch (error) {
    response = formatProviderError(error, model);
  }

  return res.json({ response });
}

async function providerStatus(_req, res) {
  const data = await getProviderStatuses();
  return res.json(data);
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
  providerStatus,
  ragAssistant
};
