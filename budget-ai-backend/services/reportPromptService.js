function formatCurrency(value) {
  return `Rs ${Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2
  })}`;
}

function buildBudgetSummaryPrompt(report) {
  const metrics = report.metrics || {};
  const input = report.input || {};

  const context = {
    report_name: report.report_name,
    period: {
      month: report.month,
      year: report.year
    },
    income: metrics.income,
    total_expenses: metrics.total_expenses,
    fixed_expenses: metrics.fixed_expenses,
    variable_expenses: metrics.variable_expenses,
    savings: metrics.savings,
    savings_rate: metrics.savings_rate,
    expense_ratio: metrics.expense_ratio,
    discretionary_ratio: metrics.discretionary_ratio,
    emergency_fund_months: metrics.emergency_fund_months,
    savings_goal: input.savings_goal || 0,
    fixed_expenses_breakdown: input.fixed_expenses_breakdown || {},
    variable_expenses_breakdown: input.variable_expenses_breakdown || {}
  };

  return `You are an expert personal budget analyst.

Analyze the monthly budget context below and respond in plain text using this exact structure:

Opinion:
<one paragraph with 30 to 50 words>

Risks:
- <2 to 3 short bullet points about risky spending patterns or concerns>

Appreciations:
- <2 to 3 short bullet points praising healthy spending or saving patterns>

Improvement Suggestions:
- <2 to 3 short bullet points with specific, actionable improvements>

Requirements:
- Base every point on the numbers provided.
- Mention exact rupee amounts or percentages when useful.
- Keep the tone supportive, practical, and direct.
- Do not mention missing context unless a section truly cannot be supported.
- Do not output markdown headings other than the four section labels above.

Budget context:
${JSON.stringify(context, null, 2)}`;
}

function parseBudgetSummary(text) {
  const raw = String(text || "").replace(/\r/g, "").trim();
  if (!raw) {
    return {
      summary: "",
      recommendations: []
    };
  }

  const opinion = extractSection(raw, "Opinion");
  const risks = extractBullets(extractSection(raw, "Risks"));
  const appreciations = extractBullets(extractSection(raw, "Appreciations"));
  const improvements = extractBullets(extractSection(raw, "Improvement Suggestions"));

  if (!opinion && !risks.length && !appreciations.length && !improvements.length) {
    return {
      summary: raw,
      recommendations: []
    };
  }

  const parts = [];

  if (opinion) {
    parts.push("Opinion:", opinion);
  }

  if (risks.length) {
    parts.push("", "Risks:", ...risks.map((item) => `- ${item}`));
  }

  if (appreciations.length) {
    parts.push("", "Appreciations:", ...appreciations.map((item) => `- ${item}`));
  }

  if (improvements.length) {
    parts.push("", "Improvement Suggestions:", ...improvements.map((item) => `- ${item}`));
  }

  return {
    summary: parts.join("\n").trim(),
    recommendations: improvements
  };
}

function buildGeneralChatPrompt(message) {
  return `You are an AI budget assistant. Answer clearly, helpfully, and briefly.

Formatting rules:
- Do not use markdown tables or plain-text tables.
- Use short paragraphs or bullet points when structure helps.

User question:
${message}`;
}

function buildRagChatPrompt({ message, reportName, contexts }) {
  const contextText = contexts
    .map((item, index) => `Context ${index + 1} (${item.metadata?.section || item.metadata?.chunk_type || "report"}):\n${item.document}`)
    .join("\n\n");

  return `You are an AI budget assistant answering questions about the attached budget report "${reportName}".

Use the retrieved report context below.
- Ground the answer in the attached report.
- If a requested number or fact is not present in the retrieved context, say it is not available in the attached report.
- Prefer exact rupee amounts, ratios, and category names from the report.
- Keep the answer concise but useful.
- Do not use markdown tables or plain-text tables.
- Use short paragraphs or bullet points instead.

User question:
${message}

Retrieved report context:
${contextText}`;
}

function buildFallbackSummary(report) {
  const metrics = report.metrics || {};
  const income = Number(metrics.income || 0);
  const totalExpenses = Number(metrics.total_expenses || 0);
  const savings = Number(metrics.savings || 0);
  const savingsRate = Number(metrics.savings_rate || 0);
  const expenseRatio = Number(metrics.expense_ratio || 0);
  const variable = Number(metrics.variable_expenses || 0);
  const variableShare = income > 0 ? Number(((variable / income) * 100).toFixed(1)) : 0;

  const risks = [];
  const appreciations = [];
  const improvements = [];

  if (expenseRatio >= 85) {
    risks.push(`Expenses already consume ${expenseRatio}% of income, so even a small unexpected bill could reduce or erase monthly savings.`);
  }
  if (savings <= 0) {
    risks.push("The budget is not producing a reliable monthly surplus right now, which weakens resilience and slows progress toward savings goals.");
  }
  if (variableShare >= 35) {
    risks.push(`Variable spending is ${variableShare}% of income, so day-to-day spending habits are the biggest risk area for drift.`);
  }

  if (savings > 0) {
    appreciations.push(`The plan still preserves about ${formatCurrency(savings)} after expenses, which gives you a real base to improve from.`);
  }
  if (expenseRatio < 80) {
    appreciations.push(`Expenses stay below 80% of income, which leaves healthier room for savings and course correction.`);
  }
  appreciations.push("You are already tracking fixed and variable expenses separately, which makes the budget easier to review and improve consistently.");

  improvements.push(`Protect at least ${formatCurrency(Math.max(1000, Math.round(income * 0.1)))} each month before discretionary spending expands.`);
  improvements.push("Review the largest variable categories first, because a small percentage cut there has more impact than many tiny reductions.");
  improvements.push("Use the savings goal as a monthly checkpoint so spending decisions are judged against a clear target instead of leftovers.");

  const summary = [
    "Opinion:",
    `This budget shows ${formatCurrency(income)} in income against ${formatCurrency(totalExpenses)} in expenses, leaving ${formatCurrency(savings)} and a ${savingsRate}% savings rate. It has a workable base, but stronger category control is needed to keep the budget healthy and repeatable.`,
    "",
    "Risks:",
    ...risks.slice(0, 3).map((item) => `- ${item}`),
    "",
    "Appreciations:",
    ...appreciations.slice(0, 3).map((item) => `- ${item}`),
    "",
    "Improvement Suggestions:",
    ...improvements.slice(0, 3).map((item) => `- ${item}`)
  ].join("\n");

  return {
    summary,
    recommendations: improvements.slice(0, 3)
  };
}

function extractSection(text, heading) {
  const regex = new RegExp(`${heading}:([\\s\\S]*?)(?=\\n[A-Za-z][A-Za-z\\s]+:|$)`, "i");
  const match = text.match(regex);
  return match?.[1]?.trim() || "";
}

function extractBullets(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

module.exports = {
  buildBudgetSummaryPrompt,
  buildFallbackSummary,
  buildGeneralChatPrompt,
  buildRagChatPrompt,
  parseBudgetSummary
};
