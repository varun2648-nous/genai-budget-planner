const { getPool } = require("../config/database");
const { calculateFinancialInsights } = require("./financialInsightsService");
const { generateGeminiAdvice } = require("./geminiService");
const { generateLocalResponse } = require("./localLlmService");
const { indexReport, deleteReportEmbeddings } = require("./ragService");
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

  const reportName = `${monthText} ${yearValue} \u2014 Report ${reportIndex}`;

  const prompt = buildReportPrompt({
    reportName,
    input,
    metrics
  });

  // Use a fast, deterministic fallback so we can return immediately.
  const fallback = buildFallbackSummary(metrics);
  let summary = fallback.summary;
  let recommendations = fallback.recommendations;

  const [result] = await pool.execute(
    `INSERT INTO reports
      (month, year, report_index, income, fixed_expenses, variable_expenses, savings_rate, expense_ratio, emergency_fund_months, discretionary_ratio, ai_summary, ai_recommendations, input_json, metrics_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      summary,
      recommendations,
      input ? JSON.stringify(input) : null,
      JSON.stringify(metrics)
    ]
  );

  const report = {
    id: result.insertId,
    month: monthText,
    year: yearValue,
    report_index: reportIndex,
    report_name: reportName,
    income: metrics.income,
    fixed_expenses: metrics.fixed_expenses,
    variable_expenses: metrics.variable_expenses,
    savings_rate: metrics.savings_rate,
    expense_ratio: metrics.expense_ratio,
    emergency_fund_months: metrics.emergency_fund_months,
    discretionary_ratio: metrics.discretionary_ratio,
    ai_summary: summary,
    ai_recommendations: recommendations,
    input,
    metrics
  };

  // Generate AI summary + index asynchronously so the response returns fast.
  setImmediate(() => {
    const aiTimeoutMs = asNumber(process.env.REPORT_AI_TIMEOUT_MS) || asNumber(process.env.LLM_TIMEOUT_MS) || 90000;
    withTimeout(generateReportText({ model, prompt }), aiTimeoutMs, "REPORT_AI_TIMEOUT")
      .then((aiText) => {
        const parsed = parseAiReport(aiText);
        const nextSummary = parsed.summary || summary;
        const nextRecommendations = parsed.recommendations || recommendations;
        summary = nextSummary;
        recommendations = nextRecommendations;
        return updateReportAi(result.insertId, nextSummary, nextRecommendations);
      })
      .catch(() => {
        // keep fallback summary/recommendations if AI fails
      })
      .finally(() => {
        indexReport({
          ...report,
          ai_summary: summary,
          ai_recommendations: recommendations
        }).catch(() => {
          // Chroma is optional; report creation should still succeed.
        });
      });
  });

  return report;
}

async function listReports() {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT id, month, year, report_index, income, fixed_expenses, variable_expenses, savings_rate, expense_ratio, emergency_fund_months, discretionary_ratio, created_at
     FROM reports
     ORDER BY year DESC, FIELD(month, 'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec') DESC, report_index DESC`
  );

  return rows.map((row) => ({
    ...row,
    report_name: `${row.month} ${row.year} \u2014 Report ${row.report_index}`
  }));
}

async function getReportById(id) {
  const pool = getPool();
  const safeId = Number.parseInt(id, 10);

  if (!safeId) return null;

  const [rows] = await pool.execute(
    `SELECT * FROM reports WHERE id = ?`,
    [safeId]
  );

  const report = rows?.[0];
  if (!report) return null;

  return {
    ...report,
    report_name: `${report.month} ${report.year} \u2014 Report ${report.report_index}`,
    input: report.input_json ? JSON.parse(report.input_json) : null,
    metrics: report.metrics_json && typeof report.metrics_json === "string"
      ? JSON.parse(report.metrics_json)
      : report.metrics_json
  };
}

async function deleteReport(id) {
  const pool = getPool();
  const safeId = Number.parseInt(id, 10);

  if (!safeId) return 0;

  const [result] = await pool.execute(
    `DELETE FROM reports WHERE id = ?`,
    [safeId]
  );

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
  const pool = getPool();
  const safeId = Number.parseInt(reportId, 10);
  if (!safeId) return;
  await pool.execute(
    `UPDATE reports SET ai_summary = ?, ai_recommendations = ? WHERE id = ?`,
    [summary, recommendations, safeId]
  );
}

function buildReportPrompt({ reportName, input, metrics }) {
  const budgetJson = JSON.stringify(
    {
      report_name: reportName,
      input: input || {},
      metrics
    },
    null,
    2
  );

  return `You are a professional financial planning advisor AI.

Analyze the provided monthly budget data and produce a detailed Budget Health Report.

WRITING RULES:
Write 4 to 5 paragraphs
Each paragraph must contain 20 to 30 words
Use clear, professional, supportive language
Provide personalized insights derived from the financial data
Do not give generic or repeated advice

REPORT STRUCTURE (output plain text exactly in this order):

Title: AI Budget Analysis

Section 1: Financial Summary
- Write 4 to 5 paragraphs (20 to 30 words each).
- Cover these themes across the paragraphs (one theme per paragraph):
  1) Overall financial performance
  2) Expense structure analysis
  3) Spending behavior insights
  4) Savings health & goal feasibility
  5) Risk & sustainability analysis
- Every paragraph must reference specific numbers from the data (amounts and/or percentages) and explain what they mean for the user's financial health.

Section 2: Financial Problems Identified
- Provide 4 to 5 bullet points.
- Each bullet must be data-driven, derived from the user's numbers, and must not be generic.

Section 3: Personalized Improvement Plan
- Provide 4 to 5 bullet points.
- Each bullet must be actionable, specific (include a percentage or monthly amount target when possible), and directly tied to the problems you identified.

OBJECTIVE:
Help the user understand their financial condition, identify weaknesses, and receive customized improvement strategies.

USER BUDGET DATA:
${budgetJson}`;
}

function normalizeNewlines(text) {
  return String(text || "").replace(/\r/g, "");
}

function extractSection(text, heading) {
  const normalized = normalizeNewlines(text);
  const lines = normalized.split("\n");
  const startIndex = lines.findIndex((l) => l.trim().toLowerCase() === heading.toLowerCase());
  if (startIndex === -1) return "";

  const collected = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      collected.push("");
      continue;
    }
    if (/^section\s+\d+\s*:/i.test(trimmed) || /^title\s*:/i.test(trimmed)) break;
    collected.push(line);
  }

  return collected.join("\n").trim();
}

function extractBullets(block) {
  const normalized = normalizeNewlines(block);
  const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);
  const bullets = [];

  for (const line of lines) {
    const m = line.match(/^[-*•]\s+(.*)$/);
    if (m && m[1]) bullets.push(m[1].trim());
  }

  if (bullets.length) return bullets;

  // If the model forgot bullet markers, treat each non-empty line as a bullet.
  return lines.map((l) => l.replace(/^\d+[\.\)]\s+/, "").trim()).filter(Boolean);
}

function parseAiReport(text) {
  if (!text) {
    return { summary: "No AI summary available.", recommendations: "" };
  }

  try {
    const cleaned = String(text).replace(/```json|```/gi, "").trim();
    const parsed = JSON.parse(cleaned);
    const summary = safeString(parsed.summary) || safeString(parsed.SUMMARY) || "";
    const recs = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
    return {
      summary: summary || cleaned.trim(),
      recommendations: recs.length ? recs.join("\n") : ""
    };
  } catch (_error) {
    const raw = normalizeNewlines(text).trim();

    // Prefer the new structured format if present.
    const titleLine = raw.split("\n").find((l) => l.trim().toLowerCase().startsWith("title:"));
    const hasNewStructure =
      Boolean(titleLine) ||
      /section\s*1\s*:\s*financial summary/i.test(raw) ||
      /section\s*2\s*:\s*financial problems identified/i.test(raw) ||
      /section\s*3\s*:\s*personalized improvement plan/i.test(raw);

    if (hasNewStructure) {
      const financialSummary = extractSection(raw, "Section 1: Financial Summary");
      const problemsBlock = extractSection(raw, "Section 2: Financial Problems Identified");
      const planBlock = extractSection(raw, "Section 3: Personalized Improvement Plan");

      const problems = extractBullets(problemsBlock).slice(0, 5);
      const plan = extractBullets(planBlock).slice(0, 5);

      const title = titleLine ? titleLine.trim() : "Title: AI Budget Analysis";
      const summaryParts = [
        title,
        "",
        "Section 1: Financial Summary",
        financialSummary || raw
      ];

      if (problems.length) {
        summaryParts.push("", "Section 2: Financial Problems Identified", ...problems.map((p) => `- ${p}`));
      }

      return {
        summary: summaryParts.join("\n").trim(),
        recommendations: plan.length ? plan.map((p) => p.replace(/^[-*•]\s+/, "")).join("\n") : ""
      };
    }

    return { summary: raw, recommendations: "" };
  }
}

async function generateReportText({ model, prompt }) {
  const normalized = String(model || "gemini").toLowerCase();

  if (normalized === "local" || normalized === "ollama" || normalized === "llama") {
    try {
      return await generateLocalResponse(prompt, { temperature: 0.4, top_p: 0.9 });
    } catch (_error) {
      if (isTimeoutError(_error)) {
        throw _error;
      }
      return generateGeminiAdvice(prompt);
    }
  }

  try {
    return await generateGeminiAdvice(prompt);
  } catch (_error) {
    if (isTimeoutError(_error)) {
      throw _error;
    }
    return generateLocalResponse(prompt, { temperature: 0.4, top_p: 0.9 });
  }
}

function withTimeout(promise, timeoutMs, code) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(code);
      err.code = code;
      reject(err);
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

function isTimeoutError(error) {
  if (!error) return false;
  const code = error.code || error?.response?.code;
  const message = String(error.message || "").toLowerCase();
  return code === "LLM_TIMEOUT" || code === "ECONNABORTED" || message.includes("timeout");
}

function buildFallbackSummary(metrics) {
  const income = Number(metrics.income || 0);
  const totalExpenses = Number(metrics.total_expenses ?? (Number(metrics.fixed_expenses || 0) + Number(metrics.variable_expenses || 0)));
  const savings = Number(metrics.savings ?? (income - totalExpenses));
  const savingsRate = Number(metrics.savings_rate ?? 0);
  const expenseRatio = Number(metrics.expense_ratio ?? 0);
  const fixed = Number(metrics.fixed_expenses || 0);
  const variable = Number(metrics.variable_expenses || 0);
  const fixedPct = income > 0 ? Number(((fixed / income) * 100).toFixed(1)) : 0;
  const variablePct = income > 0 ? Number(((variable / income) * 100).toFixed(1)) : 0;

  const problems = [];
  if (expenseRatio >= 90) problems.push(`Expenses are very high at ${expenseRatio}% of income, leaving little buffer for surprises or uneven months.`);
  if (savingsRate <= 5) problems.push(`Savings rate is only ${savingsRate}% (Rs ${Math.max(0, savings).toLocaleString()}), which slows progress toward goals and reduces resilience.`);
  if (savings < 0) problems.push(`This budget runs a monthly deficit of Rs ${Math.abs(savings).toLocaleString()}, which is not sustainable without debt or drawing down savings.`);
  if (fixedPct >= 60) problems.push(`Fixed costs consume about ${fixedPct}% of income, reducing flexibility if income drops or variable needs rise.`);
  if (variablePct >= 50) problems.push(`Variable spending is around ${variablePct}% of income, suggesting day-to-day expenses are dominating the budget and are likely the best optimization lever.`);
  if (problems.length < 4) problems.push("The budget has limited shock-absorption capacity because the gap between income and expenses is small relative to typical monthly volatility.");
  const problemsList = problems.slice(0, 5);

  const targetSavingsRate = savingsRate < 10 ? 10 : savingsRate < 20 ? 20 : Math.min(30, savingsRate + 5);
  const targetSavings = income > 0 ? Math.round((income * targetSavingsRate) / 100) : 0;
  const neededDelta = Math.max(0, targetSavings - Math.max(0, savings));
  const reduceVariableBy = variable > 0 ? Math.min(variable, Math.round(Math.max(neededDelta, variable * 0.1))) : neededDelta;

  const plan = [
    reduceVariableBy > 0
      ? `Reduce variable spending by about Rs ${reduceVariableBy.toLocaleString()} next month (roughly ${Math.max(5, Math.min(15, Math.round((reduceVariableBy / Math.max(1, variable)) * 100)))}% of variable expenses) to lift savings toward ${targetSavingsRate}%.`
      : `Maintain current spending, but redirect at least ${Math.max(10, targetSavingsRate)}% of income into savings automatically to keep progress consistent.`,
    fixedPct >= 60
      ? `Audit fixed bills and renegotiate at least one large commitment; aim to bring fixed costs below ~55% of income to improve flexibility.`
      : `Set category caps for variable spending and review them weekly so small overruns do not accumulate into a large monthly shortfall.`,
    savings < 0
      ? `Stop the deficit first: cut discretionary variable categories and delay non-urgent purchases until the monthly balance is at least break-even.`
      : `Increase savings by scheduling an auto-transfer of Rs ${Math.max(1000, Math.round(Math.max(0, savings) * 0.25)).toLocaleString()} immediately after payday, then adjust if cash flow feels tight.`,
    `Track your top 2 spending areas and set a mid-month checkpoint; if you are above 55% of the cap halfway through, pause non-essential purchases for one week.`,
    expenseRatio >= 90
      ? `Build a buffer: target a Rs ${Math.max(2000, Math.round(income * 0.03)).toLocaleString()} monthly cushion until you can cover at least one month of expenses without stress.`
      : `Once savings is stable, redirect a small portion (e.g., 10–20% of monthly savings) toward a longer-term goal so progress stays visible and motivating.`
  ].slice(0, 5);

  const summary = [
    "Title: AI Budget Analysis",
    "",
    "Section 1: Financial Summary",
    `Your monthly income is Rs ${income.toLocaleString()} against total expenses of Rs ${totalExpenses.toLocaleString()}, leaving Rs ${savings.toLocaleString()} net (${savingsRate}% savings rate), a clear signal of your current momentum.`,
    `Fixed costs are Rs ${fixed.toLocaleString()} (${fixedPct}%) while variable spending is Rs ${variable.toLocaleString()} (${variablePct}%), showing how much flexibility you have to adjust spending without disrupting essentials.`,
    `With expenses at about ${expenseRatio}% of income, small overages can quickly erase savings; the strongest insights come from tightening the largest variable drivers rather than cutting everything.`,
    `If your savings goal depends on consistent surplus, the current Rs ${Math.max(0, savings).toLocaleString()} monthly gap suggests aiming for ${targetSavingsRate}% savings (≈ Rs ${targetSavings.toLocaleString()}) is a realistic next milestone.`,
    `Overall sustainability depends on how stable your income is and how predictable expenses remain; higher fixed-cost share and a thin buffer raise risk during unexpected bills or income dips.`
  ].join("\n");

  return {
    summary: summary,
    recommendations: plan.join("\n"),
    _debug: undefined
  };
}

module.exports = {
  createReport,
  listReports,
  getReportById,
  deleteReport,
  getReportCount
};
