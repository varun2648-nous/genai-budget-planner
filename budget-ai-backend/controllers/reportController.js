const {
  createReport,
  listReports,
  getReportById,
  deleteReport
} = require("../services/reportService");
const { asNumber, safeString } = require("../services/reportServiceUtils");

async function createReportHandler(req, res) {
  const body = req.body || {};
  const month = safeString(body.month);
  const year = asNumber(body.year);
  const model = safeString(body.model || body.ai_model || "gemini") || "gemini";

  const income = asNumber(body.income ?? body.monthly_income);
  const fixedBreakdown = extractBreakdown(body.fixed_expenses_breakdown || body.fixed_expenses_items || body.fixed_expenses);
  const variableBreakdown = extractBreakdown(body.variable_expenses_breakdown || body.variable_expenses_items || body.variable_expenses);
  const fixedExpenses = asNumber(body.fixed_expenses) || sumBreakdown(fixedBreakdown);
  const variableExpenses = asNumber(body.variable_expenses) || sumBreakdown(variableBreakdown);

  if (!income) {
    return res.status(400).json({ message: "income is required" });
  }

  const input = {
    month,
    year,
    income,
    model,
    savings_goal: asNumber(body.savings_goal),
    fixed_expenses_breakdown: fixedBreakdown,
    variable_expenses_breakdown: variableBreakdown
  };

  const report = await createReport({
    month,
    year,
    income,
    fixed_expenses: fixedExpenses,
    variable_expenses: variableExpenses,
    input,
    model
  });

  return res.status(201).json(report);
}

function extractBreakdown(value) {
  if (!value || typeof value !== "object") return {};
  if (Array.isArray(value)) return {};
  return value;
}

function sumBreakdown(breakdown) {
  return Object.values(breakdown || {}).reduce((sum, item) => sum + asNumber(item), 0);
}

async function listReportsHandler(_req, res) {
  const reports = await listReports();
  return res.json(reports);
}

async function getReportHandler(req, res) {
  const report = await getReportById(req.params.id);
  if (!report) {
    return res.status(404).json({ message: "Report not found" });
  }
  return res.json(report);
}

async function deleteReportHandler(req, res) {
  const removed = await deleteReport(req.params.id);
  if (!removed) {
    return res.status(404).json({ message: "Report not found" });
  }
  return res.json({ ok: true });
}

module.exports = {
  createReportHandler,
  listReportsHandler,
  getReportHandler,
  deleteReportHandler
};
