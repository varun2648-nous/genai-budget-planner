import ReportCharts from "./ReportCharts";

const currency = (value) => `Rs ${Number(value || 0).toLocaleString()}`;
const CATEGORY_LABELS = [
  "rentEmi",
  "utilities",
  "insurance",
  "subscriptions",
  "food",
  "transport",
  "entertainment",
  "shopping",
  "other"
];

const CATEGORY_DISPLAY = {
  rentEmi: "Rent/EMI",
  utilities: "Utilities",
  insurance: "Insurance",
  subscriptions: "Subscriptions",
  food: "Food",
  transport: "Transport",
  entertainment: "Entertainment",
  shopping: "Shopping",
  other: "Others"
};

const NEEDS = new Set(["rentEmi", "utilities", "insurance", "food", "transport", "other"]);
const WANTS = new Set(["subscriptions", "entertainment", "shopping"]);

function ReportViewer({ report }) {
  if (!report) {
    return (
      <section className="card report-card">
        <h2>Report Viewer</h2>
        <p className="muted">Select a report from history or create a new one to see details.</p>
      </section>
    );
  }

  const input = report.input || {};
  const metrics = report.metrics || report;
  const fixedBreakdown = input.fixed_expenses_breakdown || {};
  const variableBreakdown = input.variable_expenses_breakdown || {};
  const fixedEntries = Object.entries(fixedBreakdown);
  const variableEntries = Object.entries(variableBreakdown);
  const totalExpenses = metrics.total_expenses ?? (metrics.fixed_expenses + metrics.variable_expenses);
  const netSavings = (metrics.income || 0) - (totalExpenses || 0);
  const categoryTotals = CATEGORY_LABELS.reduce((acc, key) => {
    const value = Number(fixedBreakdown[key] || variableBreakdown[key] || 0);
    acc[key] = value;
    return acc;
  }, {});
  const essentialsTotal = CATEGORY_LABELS.filter((key) => NEEDS.has(key)).reduce((sum, key) => sum + categoryTotals[key], 0);
  const discretionaryTotal = CATEGORY_LABELS.filter((key) => WANTS.has(key)).reduce((sum, key) => sum + categoryTotals[key], 0);
  const essentialsPct = totalExpenses > 0 ? Number(((essentialsTotal / totalExpenses) * 100).toFixed(1)) : 0;
  const discretionaryPct = totalExpenses > 0 ? Number(((discretionaryTotal / totalExpenses) * 100).toFixed(1)) : 0;
  const fixedPct = metrics.income > 0 ? Number(((metrics.fixed_expenses / metrics.income) * 100).toFixed(1)) : 0;
  const variablePct = metrics.income > 0 ? Number(((metrics.variable_expenses / metrics.income) * 100).toFixed(1)) : 0;
  const subscriptionSpend = categoryTotals.subscriptions || 0;
  const subscriptionPct = totalExpenses > 0 ? Number(((subscriptionSpend / totalExpenses) * 100).toFixed(1)) : 0;
  const subscriptionCount = subscriptionSpend > 0 ? 1 : 0;
  const topCategories = Object.entries(categoryTotals)
    .map(([key, value]) => ({
      key,
      label: CATEGORY_DISPLAY[key] || key,
      value,
      pct: totalExpenses > 0 ? Number(((value / totalExpenses) * 100).toFixed(1)) : 0
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);
  const recommendations = report.ai_recommendations
    ? report.ai_recommendations.split("\n").map((line) => line.trim()).filter(Boolean)
    : [];
  const aiSummaryLines = String(report.ai_summary || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const summaryStatusLabel = report.ai_summary_status === "failed"
    ? "Summary unavailable"
    : report.ai_summary_status === "ready"
      ? "Summary ready"
      : "Generating summary";
  const ragStatusLabel = report.index_status === "failed"
    ? "AI chat unavailable"
    : report.index_status === "ready"
      ? "Ready for AI chat"
      : "Preparing AI chat knowledge base";

  return (
    <section className="card report-card">
      <div className="section-header">
        <h2>{report.report_name || "Report Details"}</h2>
        <span className="badge">{report.month} {report.year}</span>
      </div>
      <div className="report-status-row">
        <span className="badge">{summaryStatusLabel}</span>
        <span className="badge">{ragStatusLabel}</span>
      </div>

      <div className="report-grid report-grid-compact">
        <div>
          <h3>User Inputs</h3>
          <div className="info-grid">
            <div>
              <p className="label">Income</p>
              <p className="value">{currency(metrics.income)}</p>
            </div>
            <div>
              <p className="label">Fixed Expenses</p>
              <p className="value">{currency(metrics.fixed_expenses)}</p>
            </div>
            <div>
              <p className="label">Variable Expenses</p>
              <p className="value">{currency(metrics.variable_expenses)}</p>
            </div>
            <div>
              <p className="label">Savings Goal</p>
              <p className="value">{currency(input.savings_goal)}</p>
            </div>
          </div>

          <div className="breakdown-grid">
            <div>
              <h4>Fixed Breakdown</h4>
              <ul>
                {fixedEntries.length === 0 && <li>No fixed expense details provided.</li>}
                {fixedEntries.map(([key, value]) => (
                  <li key={key}>{`${key}: ${currency(value)}`}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Variable Breakdown</h4>
              <ul>
                {variableEntries.length === 0 && <li>No variable expense details provided.</li>}
                {variableEntries.map(([key, value]) => (
                  <li key={key}>{`${key}: ${currency(value)}`}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div>
          <h3>Calculated Statistics</h3>
          <div className="stat-grid">
            <div className="stat-card">
              <p className="label">Total Expenses</p>
              <p className="value">{currency(totalExpenses)}</p>
            </div>
            <div className="stat-card">
              <p className="label">Net Savings</p>
              <p className="value">{currency(netSavings)}</p>
            </div>
            <div className="stat-card">
              <p className="label">Savings Rate</p>
              <p className="value">{metrics.savings_rate ?? 0}%</p>
            </div>
            <div className="stat-card">
              <p className="label">Expense Ratio</p>
              <p className="value">{metrics.expense_ratio ?? 0}%</p>
            </div>
          </div>
        </div>
      </div>

      <div className="card-subsection">
        <h3>Essential Monthly Stats</h3>
        <div className="stat-grid stat-grid-compact">
          <div className="stat-card">
            <p className="label">Total Income</p>
            <p className="value">{currency(metrics.income)}</p>
          </div>
          <div className="stat-card">
            <p className="label">Total Expenses</p>
            <p className="value">{currency(totalExpenses)}</p>
          </div>
          <div className="stat-card">
            <p className="label">Net Savings</p>
            <p className="value">{currency(netSavings)}</p>
          </div>
          <div className="stat-card">
            <p className="label">Savings Rate</p>
            <p className="value">{metrics.savings_rate ?? 0}%</p>
          </div>
          <div className="stat-card">
            <p className="label">Essentials vs Discretionary</p>
            <p className="value">{essentialsPct}% / {discretionaryPct}%</p>
          </div>
          <div className="stat-card">
            <p className="label">Fixed vs Variable</p>
            <p className="value">{fixedPct}% / {variablePct}%</p>
          </div>
          <div className="stat-card">
            <p className="label">Subscriptions</p>
            <p className="value">{subscriptionPct}% | {subscriptionCount} active</p>
          </div>
          <div className="stat-card">
            <p className="label">Top 3 Categories</p>
            <ul className="stat-list">
              {topCategories.map((item) => (
                <li key={item.key}>{`${item.label} (${currency(item.value)} | ${item.pct}%)`}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="card-subsection">
        <h3>Visual Insights</h3>
        <ReportCharts metrics={metrics} input={input} />
      </div>

      <div className="ai-summary">
        <h3>AI Summary</h3>
        {report.ai_summary ? (
          <div className="ai-advice">
            {aiSummaryLines.map((line, index) => (
              <div key={`${line}-${index}`}>{line}</div>
            ))}
          </div>
        ) : (
          <p>
            {report.ai_summary_status === "failed"
              ? (report.ai_summary_error || "AI summary could not be generated for this report.")
              : "AI summary is being generated in the background."}
          </p>
        )}
        {recommendations.length > 0 && (
          <div>
            <h4>Key Recommendations</h4>
            <ul>
              {recommendations.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

export default ReportViewer;
