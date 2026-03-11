import { useMemo } from "react";

function BudgetHistory({ reports = [], selectedId, onSelect, onDelete, loading }) {
  const grouped = useMemo(() => {
    const map = new Map();

    reports.forEach((report) => {
      const key = `${report.month} ${report.year}`;
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(report);
    });

    return Array.from(map.entries());
  }, [reports]);

  return (
    <section className="card history-card">
      <div className="section-header">
        <h2>Budget History</h2>
        {loading && <span className="badge">Loading</span>}
      </div>

      {grouped.length === 0 && !loading && (
        <p className="muted">No reports yet. Create your first report to start tracking history.</p>
      )}

      <div className="history-list">
        {grouped.map(([period, items]) => (
          <div key={period} className="history-group">
            <p className="history-period">{period}</p>
            <div className="history-items">
              {items.map((report) => (
                <div
                  key={report.id}
                  className={`history-item ${selectedId === report.id ? "is-active" : ""}`}
                  onClick={() => onSelect(report.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onSelect(report.id);
                  }}
                >
                  <span>{`Report ${report.report_index}`}</span>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete?.(report);
                    }}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default BudgetHistory;
