const { getPool } = require("../config/database");
const { deleteReportEmbeddings } = require("./ragService");
const { calculateFinancialInsights } = require("./financialInsightsService");
const { asNumber, safeString } = require("./reportServiceUtils");

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];

async function createReport({ month, year, income, fixed_expenses, variable_expenses, input, model }) {
  const pool = getPool();
  const monthText = safeString(month) || MONTHS[new Date().getMonth()];
  const yearValue = asNumber(year) || new Date().getFullYear();

  const [rows] = await pool.execute(
    `SELECT COALESCE(MAX(report_index), 0) AS max_index
     FROM reports
     WHERE month = ? AND year = ?`,
    [monthText, yearValue]
  );

  const reportIndex = Number(rows?.[0]?.max_index || 0) + 1;
  const metrics = calculateFinancialInsights({
    income,
    fixedExpenses: fixed_expenses,
    variableExpenses: variable_expenses
  });
  const reportName = `${monthText} ${yearValue} — Report ${reportIndex}`;

  const [result] = await pool.execute(
    `INSERT INTO reports
      (month, year, report_index, income, fixed_expenses, variable_expenses, savings_rate, expense_ratio, emergency_fund_months, discretionary_ratio, ai_summary, ai_recommendations, ai_summary_status, index_status, input_json, metrics_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      monthText,
      yearValue,
      reportIndex,
      metrics.income,
      metrics.fixed_expenses,
      metrics.variable_expenses,
      metrics.savings_rate,
      metrics.expense_ratio,
      metrics.emergency_fund_months,
      metrics.discretionary_ratio,
      "",
      "",
      "pending",
      "pending",
      input ? JSON.stringify(input) : null,
      JSON.stringify(metrics)
    ]
  );

  const report = mapReportRow({
    id: result.insertId,
    month: monthText,
    year: yearValue,
    report_index: reportIndex,
    income: metrics.income,
    fixed_expenses: metrics.fixed_expenses,
    variable_expenses: metrics.variable_expenses,
    savings_rate: metrics.savings_rate,
    expense_ratio: metrics.expense_ratio,
    emergency_fund_months: metrics.emergency_fund_months,
    discretionary_ratio: metrics.discretionary_ratio,
    ai_summary: "",
    ai_recommendations: "",
    ai_summary_status: "pending",
    ai_summary_error: null,
    index_status: "pending",
    index_error: null,
    llm_provider: null,
    embedding_provider: null,
    input_json: input ? JSON.stringify(input) : null,
    metrics_json: JSON.stringify(metrics)
  });

  setImmediate(() => {
    const { enqueueReportProcessing } = require("./reportProcessingService");
    enqueueReportProcessing({
      reportId: result.insertId,
      modelChoice: model
    });
  });

  return {
    ...report,
    report_name: reportName
  };
}

async function listReports() {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT id, month, year, report_index, income, fixed_expenses, variable_expenses, savings_rate, expense_ratio, emergency_fund_months, discretionary_ratio, ai_summary_status, ai_summary_error, index_status, index_error, llm_provider, embedding_provider, created_at
     FROM reports
     ORDER BY year DESC, FIELD(month, 'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec') DESC, report_index DESC`
  );

  return rows.map(mapReportRow);
}

async function getReportById(id) {
  const pool = getPool();
  const safeId = Number.parseInt(id, 10);
  if (!safeId) return null;

  const [rows] = await pool.execute(`SELECT * FROM reports WHERE id = ?`, [safeId]);
  const report = rows?.[0];
  if (!report) return null;

  return mapReportRow(report);
}

async function deleteReport(id) {
  const pool = getPool();
  const safeId = Number.parseInt(id, 10);
  if (!safeId) return 0;

  const [result] = await pool.execute(`DELETE FROM reports WHERE id = ?`, [safeId]);
  if (result.affectedRows) {
    await deleteReportEmbeddings(safeId);
  }

  return result.affectedRows || 0;
}

async function getReportCount() {
  const pool = getPool();
  const [rows] = await pool.execute(`SELECT COUNT(*) AS total FROM reports`);
  return Number(rows?.[0]?.total || 0);
}

async function updateReportAi(reportId, summary, recommendations) {
  const safeId = Number.parseInt(reportId, 10);
  if (!safeId) return;

  const pool = getPool();
  await pool.execute(
    `UPDATE reports SET ai_summary = ?, ai_recommendations = ? WHERE id = ?`,
    [summary, recommendations, safeId]
  );
}

async function updateReportSummaryState(reportId, fields) {
  await updateReportState(reportId, fields);
}

async function updateReportIndexState(reportId, fields) {
  await updateReportState(reportId, fields);
}

async function updateReportState(reportId, fields) {
  const safeId = Number.parseInt(reportId, 10);
  if (!safeId) return;

  const entries = Object.entries(fields || {}).filter(([, value]) => value !== undefined);
  if (!entries.length) return;

  const setClause = entries.map(([key]) => `${key} = ?`).join(", ");
  const values = entries.map(([, value]) => value);
  values.push(safeId);

  const pool = getPool();
  await pool.execute(`UPDATE reports SET ${setClause} WHERE id = ?`, values);
}

function mapReportRow(report) {
  const mapped = {
    ...report,
    report_name: `${report.month} ${report.year} — Report ${report.report_index}`,
    input: report.input_json ? JSON.parse(report.input_json) : null,
    metrics: report.metrics_json && typeof report.metrics_json === "string"
      ? JSON.parse(report.metrics_json)
      : report.metrics_json
  };

  mapped.ready_for_chat = mapped.index_status === "ready";
  mapped.processing = {
    ai_summary_status: mapped.ai_summary_status || "pending",
    ai_summary_error: mapped.ai_summary_error || null,
    index_status: mapped.index_status || "pending",
    index_error: mapped.index_error || null,
    ready_for_chat: mapped.ready_for_chat
  };

  return mapped;
}

module.exports = {
  createReport,
  deleteReport,
  getReportById,
  getReportCount,
  listReports,
  updateReportAi,
  updateReportIndexState,
  updateReportSummaryState
};
