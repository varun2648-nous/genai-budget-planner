import BudgetChart from "./BudgetChart";

const currency = (value) => `Rs ${Number(value || 0).toLocaleString()}`;

const SECTION_TITLES = [
  "FINANCIAL SUMMARY",
  "SPENDING ANALYSIS",
  "BUDGET BREAKDOWN",
  "KEY INSIGHTS",
  "PERSONALIZED RECOMMENDATIONS",
  "LONG TERM FINANCIAL SUGGESTIONS"
];

function parseStructuredAdvice(text) {
  if (!text) return [];

  const normalized = String(text).replace(/\r/g, "").trim();
  const lines = normalized.split("\n");
  const sections = [];

  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      if (current) current.content.push("");
      continue;
    }

    const matchedTitle = SECTION_TITLES.find((title) => line.toUpperCase() === title);

    if (matchedTitle) {
      if (current) {
        sections.push({
          title: current.title,
          text: current.content.join("\n").trim()
        });
      }

      current = { title: matchedTitle, content: [] };
      continue;
    }

    if (current) {
      current.content.push(rawLine);
    }
  }

  if (current) {
    sections.push({
      title: current.title,
      text: current.content.join("\n").trim()
    });
  }

  return sections.filter((section) => section.text);
}

function BudgetResult({ result }) {
  const {
    recommended_budget: recommended,
    actual_budget: actual,
    suggestions,
    ai_advice: aiAdviceLegacy,
    ai_analysis: aiAnalysis
  } = result;
  const aiAdvice = aiAnalysis || aiAdviceLegacy;
  const adviceSections = parseStructuredAdvice(aiAdvice);

  return (
    <div className="card result-card">
      <h2>Budget Results</h2>

      <div className="results-layout">
        <section>
          <h3>Pie Chart</h3>
          <BudgetChart budget={actual} />
        </section>

        <section>
          <h3>Budget Breakdown</h3>
          <div className="breakdown-grid">
            <div>
              <h4>Recommended Budget</h4>
              <ul>
                <li>Needs: {currency(recommended.needs)}</li>
                <li>Wants: {currency(recommended.wants)}</li>
                <li>Savings: {currency(recommended.savings)}</li>
              </ul>
            </div>

            <div>
              <h4>Your Current Budget</h4>
              <ul>
                <li>Needs: {currency(actual.needs)}</li>
                <li>Wants: {currency(actual.wants)}</li>
                <li>Savings: {currency(actual.savings)}</li>
              </ul>
            </div>
          </div>
        </section>
      </div>

      <section>
        <h3>AI Suggestions</h3>
        <ul>
          {(suggestions || []).map((tip, index) => (
            <li key={index}>{tip}</li>
          ))}
        </ul>
      </section>

      {aiAdvice && (
        <section>
          <h3>AI Advisor Report</h3>

          {adviceSections.length > 0 ? (
            <div className="ai-sections-grid">
              {adviceSections.map((section) => (
                <article key={section.title} className="ai-section-card">
                  <h4>{section.title}</h4>
                  <p>{section.text}</p>
                </article>
              ))}
            </div>
          ) : (
            <pre className="ai-advice">{aiAdvice}</pre>
          )}
        </section>
      )}
    </div>
  );
}

export default BudgetResult;
