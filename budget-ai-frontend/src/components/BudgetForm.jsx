import { useMemo, useState } from "react";

const fixedExpenseFields = [
  { key: "rentEmi", label: "Rent / EMI" },
  { key: "utilities", label: "Utilities" },
  { key: "insurance", label: "Insurance" },
  { key: "subscriptions", label: "Subscriptions" }
];

const variableExpenseFields = [
  { key: "food", label: "Food" },
  { key: "transport", label: "Transport" },
  { key: "entertainment", label: "Entertainment" },
  { key: "shopping", label: "Shopping" },
  { key: "other", label: "Other" }
];

const months = [
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

const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 7 }, (_, idx) => currentYear - 3 + idx);

const initialState = {
  model: "gemini",
  month: months[new Date().getMonth()],
  year: currentYear,
  monthlyIncome: "",
  savingsGoal: "",
  fixedExpenses: {
    rentEmi: "",
    utilities: "",
    insurance: "",
    subscriptions: ""
  },
  variableExpenses: {
    food: "",
    transport: "",
    entertainment: "",
    shopping: "",
    other: ""
  }
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

function BudgetForm({ onSubmit, loading = false, reportCounts = {} }) {
  const [formData, setFormData] = useState(initialState);

  const totals = useMemo(() => {
    const fixedTotal = Object.values(formData.fixedExpenses).reduce(
      (sum, value) => sum + toNumber(value),
      0
    );
    const variableTotal = Object.values(formData.variableExpenses).reduce(
      (sum, value) => sum + toNumber(value),
      0
    );
    const totalExpenses = fixedTotal + variableTotal;
    const income = toNumber(formData.monthlyIncome);

    return {
      fixedTotal,
      variableTotal,
      totalExpenses,
      estimatedBalance: income - totalExpenses
    };
  }, [formData]);

  const reportIndex = useMemo(() => {
    const key = `${formData.month}-${formData.year}`;
    const count = reportCounts[key] || 0;
    return count + 1;
  }, [formData.month, formData.year, reportCounts]);

  const reportName = `${formData.month} ${formData.year} \u2014 Report ${reportIndex}`;

  const handleTopLevelChange = (event) => {
    const { name, value } = event.target;
    setFormData((previous) => ({
      ...previous,
      [name]: name === "year" ? Number(value) : value
    }));
  };

  const handleExpenseChange = (category, key, value) => {
    setFormData((previous) => ({
      ...previous,
      [category]: {
        ...previous[category],
        [key]: value
      }
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    const payload = {
      model: formData.model,
      month: formData.month,
      year: formData.year,
      report_name: reportName,
      income: toNumber(formData.monthlyIncome),
      savings_goal: toNumber(formData.savingsGoal),
      fixed_expenses_breakdown: Object.fromEntries(
        Object.entries(formData.fixedExpenses).map(([key, value]) => [key, toNumber(value)])
      ),
      variable_expenses_breakdown: Object.fromEntries(
        Object.entries(formData.variableExpenses).map(([key, value]) => [key, toNumber(value)])
      ),
      fixed_expenses: totals.fixedTotal,
      variable_expenses: totals.variableTotal
    };

    onSubmit(payload);
  };

  return (
    <form className="card form-card" onSubmit={handleSubmit}>
      <h2>AI Model</h2>
      <div className="model-selector">
        <label>
          <input
            type="radio"
            name="model"
            value="gemini"
            checked={formData.model === "gemini"}
            onChange={handleTopLevelChange}
            disabled={loading}
          />
          Gemini (Cloud)
        </label>
        <label>
          <input
            type="radio"
            name="model"
            value="openrouter"
            checked={formData.model === "openrouter"}
            onChange={handleTopLevelChange}
            disabled={loading}
          />
          OpenRouter
        </label>
        <label>
          <input
            type="radio"
            name="model"
            value="local"
            checked={formData.model === "local"}
            onChange={handleTopLevelChange}
            disabled={loading}
          />
          Local LLM
        </label>
      </div>
      <h2>Budget Period</h2>
      <div className="grid-2">
        <div>
          <label className="field-label" htmlFor="month">
            Month
          </label>
          <select
            id="month"
            name="month"
            value={formData.month}
            onChange={handleTopLevelChange}
            disabled={loading}
          >
            {months.map((month) => (
              <option key={month} value={month}>{month}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="year">
            Year
          </label>
          <select
            id="year"
            name="year"
            value={formData.year}
            onChange={handleTopLevelChange}
            disabled={loading}
          >
            {yearOptions.map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </div>
      </div>

      <label className="field-label" htmlFor="reportName">
        Report Name
      </label>
      <input
        id="reportName"
        name="reportName"
        type="text"
        value={reportName}
        readOnly
      />

      <h2>Monthly Income</h2>
      <label className="field-label" htmlFor="monthlyIncome">
        Income Amount
      </label>
      <input
        id="monthlyIncome"
        name="monthlyIncome"
        type="number"
        min="0"
        step="100"
        placeholder="e.g. 85000"
        value={formData.monthlyIncome}
        onChange={handleTopLevelChange}
        onWheel={(event) => event.currentTarget.blur()}
        required
        disabled={loading}
      />

      <div className="grid-2">
        <section>
          <h3>Fixed Expenses</h3>
          {fixedExpenseFields.map((field) => (
            <div key={field.key}>
              <label className="field-label" htmlFor={`fixed-${field.key}`}>
                {field.label}
              </label>
              <input
                id={`fixed-${field.key}`}
                type="number"
                min="0"
                step="100"
                placeholder="0"
                value={formData.fixedExpenses[field.key]}
                onChange={(event) =>
                  handleExpenseChange("fixedExpenses", field.key, event.target.value)
                }
                onWheel={(event) => event.currentTarget.blur()}
                disabled={loading}
              />
            </div>
          ))}
        </section>

        <section>
          <h3>Variable Expenses</h3>
          {variableExpenseFields.map((field) => (
            <div key={field.key}>
              <label className="field-label" htmlFor={`variable-${field.key}`}>
                {field.label}
              </label>
              <input
                id={`variable-${field.key}`}
                type="number"
                min="0"
                step="100"
                placeholder="0"
                value={formData.variableExpenses[field.key]}
                onChange={(event) =>
                  handleExpenseChange("variableExpenses", field.key, event.target.value)
                }
                onWheel={(event) => event.currentTarget.blur()}
                disabled={loading}
              />
            </div>
          ))}
        </section>
      </div>

      <h3>Financial Goals</h3>
      <label className="field-label" htmlFor="savingsGoal">
        Savings Goal (Monthly)
      </label>
      <input
        id="savingsGoal"
        name="savingsGoal"
        type="number"
        min="0"
        step="100"
        placeholder="e.g. 15000"
        value={formData.savingsGoal}
        onChange={handleTopLevelChange}
        onWheel={(event) => event.currentTarget.blur()}
        disabled={loading}
      />

      <div className="summary-row">
        <p>Fixed: <strong>Rs {totals.fixedTotal.toLocaleString()}</strong></p>
        <p>Variable: <strong>Rs {totals.variableTotal.toLocaleString()}</strong></p>
        <p>Total Expenses: <strong>Rs {totals.totalExpenses.toLocaleString()}</strong></p>
        <p>Estimated Balance: <strong>Rs {totals.estimatedBalance.toLocaleString()}</strong></p>
      </div>

      <button type="submit" disabled={loading}>
        {loading ? "Generating..." : "Generate Budget Report"}
      </button>
    </form>
  );
}

export default BudgetForm;

