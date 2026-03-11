const { asNumber } = require("./reportServiceUtils");

function calculateFinancialInsights({ income, fixedExpenses, variableExpenses }) {
  const safeIncome = asNumber(income);
  const safeFixed = asNumber(fixedExpenses);
  const safeVariable = asNumber(variableExpenses);
  const totalExpenses = safeFixed + safeVariable;
  const savings = safeIncome - totalExpenses;

  const savingsRate = safeIncome > 0 ? Number((((safeIncome - totalExpenses) / safeIncome) * 100).toFixed(2)) : 0;
  const expenseRatio = safeIncome > 0 ? Number(((totalExpenses / safeIncome) * 100).toFixed(2)) : 0;
  const discretionaryRatio = safeIncome > 0 ? Number(((safeVariable / safeIncome) * 100).toFixed(2)) : 0;

  const emergencyFundMonths =
    totalExpenses > 0 ? Math.max(0, Math.floor(savings / totalExpenses)) : null;

  return {
    income: safeIncome,
    fixed_expenses: safeFixed,
    variable_expenses: safeVariable,
    total_expenses: totalExpenses,
    savings,
    savings_rate: savingsRate,
    expense_ratio: expenseRatio,
    emergency_fund_months: emergencyFundMonths,
    discretionary_ratio: discretionaryRatio
  };
}

module.exports = {
  calculateFinancialInsights
};
