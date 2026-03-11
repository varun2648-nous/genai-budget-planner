import { useMemo, useState } from "react";
import { ragAi } from "../api/api";

function AIAssistantChat({ reports = [], selectedReport = null }) {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState("gemini");
  const [attachedReportId, setAttachedReportId] = useState("");

  const reportOptions = useMemo(() => reports
    .filter((report) => report.ready_for_chat)
    .map((report) => ({
      id: report.id,
      label: report.report_name || `${report.month} ${report.year} Report ${report.report_index}`,
      month: report.month,
      year: report.year
    })), [reports]);

  const pendingCount = useMemo(
    () => reports.filter((report) => report.index_status === "pending" || report.index_status === "processing").length,
    [reports]
  );

  const attachedReport = reportOptions.find((option) => String(option.id) === String(attachedReportId)) || null;
  const preparationLabel = selectedReport && !selectedReport.ready_for_chat
    ? (selectedReport.index_status === "failed" ? "Report knowledge base failed" : "Preparing selected report for AI chat")
    : pendingCount > 0
      ? `${pendingCount} report${pendingCount > 1 ? "s are" : " is"} being prepared`
      : "Report knowledge base ready";

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setResponse("");

    try {
      const result = await ragAi({
        message: trimmed,
        model,
        attached_report_id: attachedReport ? attachedReport.id : null,
        attached_month: attachedReport ? attachedReport.month : null,
        attached_year: attachedReport ? attachedReport.year : null
      });
      setResponse(result?.response || "No response available.");
    } catch (_error) {
      const message = String(_error?.message || "").toLowerCase();
      const isTimeout = _error?.code === "ECONNABORTED" || message.includes("timeout");
      setResponse(isTimeout
        ? "The AI model is taking longer than expected. Please try again in a moment."
        : "LLM responded with an error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="card chat-card">
      <div className="section-header">
        <h2>AI Budget Assistant</h2>
      </div>

      <div className="chat-options">
        <div>
          <p className="label">LLM</p>
          <div className="model-selector">
            <label>
              <input
                type="radio"
                name="chat-model"
                value="gemini"
                checked={model === "gemini"}
                onChange={() => setModel("gemini")}
                disabled={loading}
              />
              Gemini (Default)
            </label>
            <label>
              <input
                type="radio"
                name="chat-model"
                value="openrouter"
                checked={model === "openrouter"}
                onChange={() => setModel("openrouter")}
                disabled={loading}
              />
              OpenRouter
            </label>
            <label>
              <input
                type="radio"
                name="chat-model"
                value="local"
                checked={model === "local"}
                onChange={() => setModel("local")}
                disabled={loading}
              />
              Local LLM
            </label>
          </div>
        </div>

        <div>
          <p className="label">Attach Report (Optional)</p>
          <select
            value={attachedReportId}
            onChange={(event) => setAttachedReportId(event.target.value)}
            disabled={loading}
          >
            <option value="">No report attached</option>
            {reportOptions.map((report) => (
              <option key={report.id} value={report.id}>{report.label}</option>
            ))}
          </select>
          {reportOptions.length === 0 && (
            <p className="muted">Reports appear here only after chunking, embedding, and storage finish.</p>
          )}
        </div>
      </div>

      <button type="button" className="ghost-button status-pill" disabled>
        {preparationLabel}
      </button>

      <form className="chat-input" onSubmit={handleSubmit}>
        <textarea
          rows={2}
          placeholder="Ask about your budget, trends, or comparisons."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={loading}
        />
        <button type="submit" disabled={loading}>
          {loading ? "Sending..." : "Ask"}
        </button>
      </form>

      {response && (
        <div className="chat-response">
          <h4>Response</h4>
          <div className="ai-advice">{response}</div>
        </div>
      )}
    </section>
  );
}

export default AIAssistantChat;
