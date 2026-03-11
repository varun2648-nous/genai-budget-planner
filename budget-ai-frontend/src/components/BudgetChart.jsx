import { Pie } from "react-chartjs-2";
import { ArcElement, Chart as ChartJS, Legend, Tooltip } from "chart.js";

ChartJS.register(ArcElement, Tooltip, Legend);

function BudgetChart({ budget }) {
  const data = {
    labels: ["Needs", "Wants", "Savings"],
    datasets: [
      {
        data: [budget.needs || 0, budget.wants || 0, budget.savings || 0],
        backgroundColor: ["#b4885f", "#d0a676", "#8f623f"],
        borderColor: "#f5efe5",
        borderWidth: 2
      }
    ]
  };

  const options = {
    plugins: {
      legend: {
        position: "bottom"
      }
    }
  };

  return (
    <div className="chart-wrap">
      <Pie data={data} options={options} />
    </div>
  );
}

export default BudgetChart;