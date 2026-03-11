import { Doughnut, Line, Pie } from "react-chartjs-2";
import {
  ArcElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip
} from "chart.js";

ChartJS.register(ArcElement, CategoryScale, LineElement, LinearScale, PointElement, Tooltip, Legend);

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

function ReportCharts({ metrics, input }) {
  const fixedBreakdown = input?.fixed_expenses_breakdown || {};
  const variableBreakdown = input?.variable_expenses_breakdown || {};
  const categoryTotals = CATEGORY_LABELS.reduce((acc, key) => {
    const value = Number(fixedBreakdown[key] || variableBreakdown[key] || 0);
    acc[key] = value;
    return acc;
  }, {});

  const totalExpenses = metrics?.total_expenses || 0;
  const savingsGoal = input?.savings_goal || 0;
  const netSavings = (metrics?.income || 0) - totalExpenses;

  const donutData = {
    labels: CATEGORY_LABELS.map((key) => CATEGORY_DISPLAY[key]),
    datasets: [
      {
        data: CATEGORY_LABELS.map((key) => categoryTotals[key] || 0),
        backgroundColor: [
          "#b4885f",
          "#d0a676",
          "#b27f4c",
          "#c79d6d",
          "#8f623f",
          "#a6754c",
          "#d4b08a",
          "#b8926a",
          "#d0b28e"
        ],
        borderColor: "#fffaf3",
        borderWidth: 2
      }
    ]
  };

  const donutOptions = {
    maintainAspectRatio: false,
    responsive: true,
    plugins: {
      legend: {
        position: "right",
        labels: { boxWidth: 12, padding: 10 }
      }
    }
  };

  const fixedVsVariable = {
    labels: ["Fixed", "Variable"],
    datasets: [
      {
        data: [metrics?.fixed_expenses || 0, metrics?.variable_expenses || 0],
        backgroundColor: ["#8f623f", "#d0a676"],
        borderColor: "#fffaf3",
        borderWidth: 2
      }
    ]
  };

  const pieOptions = {
    maintainAspectRatio: false,
    responsive: true,
    plugins: {
      legend: {
        position: "bottom",
        labels: { boxWidth: 12, padding: 12 }
      }
    }
  };

  const months = Array.from({ length: 12 }, (_, idx) => `M${idx + 1}`);
  const savingsTrend = months.map((_, idx) => netSavings * (idx + 1));
  const goalTrend = months.map((_, idx) => savingsGoal * (idx + 1));

  const lineData = {
    labels: months,
    datasets: [
      {
        label: "Actual Savings",
        data: savingsTrend,
        borderColor: "#8f623f",
        backgroundColor: "rgba(143, 98, 63, 0.15)",
        tension: 0.3,
        fill: true
      },
      {
        label: "Savings Goal",
        data: goalTrend,
        borderColor: "#b4885f",
        borderDash: [6, 6],
        backgroundColor: "rgba(180, 136, 95, 0.1)",
        tension: 0.3,
        fill: false
      }
    ]
  };

  const lineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "bottom" }
    },
    scales: {
      y: {
        ticks: { color: "#6f5440" },
        grid: { color: "rgba(217, 185, 149, 0.4)" }
      },
      x: {
        ticks: { color: "#6f5440" },
        grid: { display: false }
      }
    }
  };

  return (
    <div className="charts-grid">
      <div className="chart-card">
        <h4>Category-wise Expense Split</h4>
        <div className="chart-body chart-body--donut">
          <Doughnut data={donutData} options={donutOptions} />
        </div>
      </div>
      <div className="chart-card">
        <h4>Fixed vs Variable Expenses</h4>
        <div className="chart-body">
          <Pie data={fixedVsVariable} options={pieOptions} />
        </div>
      </div>
      <div className="chart-card">
        <h4>Actual Savings vs Savings Goal (12 months)</h4>
        <div className="chart-body chart-body--line">
          <Line data={lineData} options={lineOptions} />
        </div>
      </div>
    </div>
  );
}

export default ReportCharts;
