function buildReportChunks(report) {
  const metrics = report.metrics || {};
  const input = report.input || {};
  const fixedBreakdown = input.fixed_expenses_breakdown || {};
  const variableBreakdown = input.variable_expenses_breakdown || {};

  const sections = [
    {
      section: "report_overview",
      text: [
        `Report Name: ${report.report_name}`,
        `Month: ${report.month}`,
        `Year: ${report.year}`,
        `Report Index: ${report.report_index}`,
        `Income: ${metrics.income}`,
        `Total Expenses: ${metrics.total_expenses}`,
        `Savings: ${metrics.savings}`,
        `Savings Goal: ${input.savings_goal || 0}`
      ].join("\n")
    },
    {
      section: "fixed_expenses",
      text: objectToLines("Fixed Expense Breakdown", fixedBreakdown)
    },
    {
      section: "variable_expenses",
      text: objectToLines("Variable Expense Breakdown", variableBreakdown)
    },
    {
      section: "financial_metrics",
      text: [
        "Financial Metrics",
        `Fixed Expenses: ${metrics.fixed_expenses}`,
        `Variable Expenses: ${metrics.variable_expenses}`,
        `Savings Rate: ${metrics.savings_rate}%`,
        `Expense Ratio: ${metrics.expense_ratio}%`,
        `Discretionary Ratio: ${metrics.discretionary_ratio}%`,
        `Emergency Fund Months: ${metrics.emergency_fund_months}`
      ].join("\n")
    }
  ];

  if (report.ai_summary) {
    sections.push({
      section: "ai_summary",
      text: report.ai_summary
    });
  }

  if (report.ai_recommendations) {
    sections.push({
      section: "ai_recommendations",
      text: `Improvement Suggestions\n${report.ai_recommendations}`
    });
  }

  const chunks = [];
  let counter = 1;

  sections
    .filter((section) => section.text && section.text.trim())
    .forEach((section) => {
      splitText(section.text, 700, 120).forEach((slice) => {
        chunks.push({
          id: `${report.id}-chunk-${counter}`,
          document: slice,
          metadata: {
            reportId: Number(report.id),
            month: report.month,
            year: Number(report.year),
            report_index: Number(report.report_index),
            section: section.section,
            chunk_type: section.section
          }
        });
        counter += 1;
      });
    });

  return chunks;
}

function objectToLines(title, value) {
  const entries = Object.entries(value || {});
  if (!entries.length) {
    return `${title}\nNo values provided`;
  }

  return [
    title,
    ...entries.map(([key, amount]) => `${key}: ${amount}`)
  ].join("\n");
}

function splitText(text, maxChars, overlapChars) {
  const normalized = String(text || "").trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const chunks = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length);
    if (end < normalized.length) {
      const lastBreak = normalized.lastIndexOf("\n", end);
      const lastSpace = normalized.lastIndexOf(" ", end);
      const boundary = Math.max(lastBreak, lastSpace);
      if (boundary > start + Math.floor(maxChars * 0.6)) {
        end = boundary;
      }
    }

    const slice = normalized.slice(start, end).trim();
    if (slice) {
      chunks.push(slice);
    }

    if (end >= normalized.length) {
      break;
    }

    start = Math.max(end - overlapChars, start + 1);
  }

  return chunks;
}

module.exports = {
  buildReportChunks
};
