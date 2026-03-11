import { useEffect, useMemo, useState } from "react";
import BudgetForm from "../components/BudgetForm";
import BudgetHistory from "../components/BudgetHistory";
import ReportViewer from "../components/ReportViewer";
import AIAssistantChat from "../components/AIAssistantChat";
import { createReport, deleteReport, fetchReport, fetchReports } from "../api/api";

function Home() {
  const [reports, setReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState("");

  const reportCounts = useMemo(() => {
    const map = {};
    reports.forEach((report) => {
      const key = `${report.month}-${report.year}`;
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }, [reports]);

  const loadReports = async () => {
    setHistoryLoading(true);
    try {
      const data = await fetchReports();
      setReports(data || []);
    } catch {
      setError("Unable to load report history. Verify the backend is running on http://localhost:8000.");
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, []);

  useEffect(() => {
    if (!selectedReport?.id) return undefined;
    const summaryTerminal = ["ready", "failed"].includes(selectedReport.ai_summary_status);
    const indexTerminal = ["ready", "failed"].includes(selectedReport.index_status);
    if (summaryTerminal && indexTerminal) {
      return undefined;
    }

    const timer = window.setInterval(async () => {
      try {
        const [report, reportList] = await Promise.all([
          fetchReport(selectedReport.id),
          fetchReports()
        ]);
        setSelectedReport(report);
        setReports(reportList || []);
      } catch {
        // Silent polling failure; the next cycle can recover.
      }
    }, 3500);

    return () => window.clearInterval(timer);
  }, [selectedReport?.id, selectedReport?.index_status, selectedReport?.ai_summary_status]);

  const handleSubmit = async (payload) => {
    setLoading(true);
    setError("");

    try {
      const created = await createReport(payload);
      setSelectedReport(created);
      await loadReports();
    } catch (err) {
      const message = String(err?.message || "").toLowerCase();
      const isTimeout = err?.code === "ECONNABORTED" || message.includes("timeout");
      setError(isTimeout
        ? "Report generation is taking longer than expected. Please try again in a moment."
        : "LLM responded with an error");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectReport = async (reportId) => {
    setError("");
    try {
      const report = await fetchReport(reportId);
      setSelectedReport(report);
    } catch {
      setError("Unable to load the selected report.");
    }
  };

  const handleDeleteReport = async (report) => {
    if (!report?.id) return;
    const confirmed = window.confirm(`Delete ${report.report_name || "this report"}?`);
    if (!confirmed) return;

    setError("");
    try {
      await deleteReport(report.id);
      if (selectedReport?.id === report.id) {
        setSelectedReport(null);
      }
      await loadReports();
    } catch {
      setError("Unable to delete the selected report.");
    }
  };

  return (
    <div className="container">
      <header className="hero card">
        <p className="eyebrow">AI Finance Planner</p>
        <h1>AI Budget Planning Assistant</h1>
      </header>

      <div className="dashboard-grid">
        <div className="stack">
          <BudgetForm onSubmit={handleSubmit} loading={loading} reportCounts={reportCounts} />

          {loading && <p className="status-text">Generating AI budget report...</p>}
          {error && <p className="status-text error-text">{error}</p>}

          <ReportViewer report={selectedReport} />
        </div>

        <div className="stack">
          <BudgetHistory
            reports={reports}
            selectedId={selectedReport?.id}
            onSelect={handleSelectReport}
            onDelete={handleDeleteReport}
            loading={historyLoading}
          />
          <AIAssistantChat reports={reports} selectedReport={selectedReport} />
        </div>
      </div>
    </div>
  );
}

export default Home;
