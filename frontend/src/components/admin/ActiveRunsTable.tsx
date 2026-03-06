import type { ActiveRunRow } from "./types";

interface ActiveRunsTableProps {
  rows: ActiveRunRow[];
  loading: boolean;
  onOpenRun: (row: ActiveRunRow) => void;
}

const formatTime = (ts: number): string => {
  if (!Number.isFinite(ts) || ts <= 0) {
    return "-";
  }
  return new Date(ts).toLocaleTimeString();
};

export const ActiveRunsTable = ({ rows, loading, onOpenRun }: ActiveRunsTableProps) => {
  return (
    <section className="admin-runs-panel">
      <header className="admin-panel-header">
        <h3>Active Runs</h3>
        <span>{rows.length} rows</span>
      </header>

      <div className="admin-runs-table-wrap">
        <table className="admin-runs-table">
          <thead>
            <tr>
              <th>topicId</th>
              <th>runId</th>
              <th>status</th>
              <th>current_module</th>
              <th>awaiting_approval</th>
              <th>updated</th>
              <th>action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="muted">
                  Loading active runs...
                </td>
              </tr>
            ) : null}

            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  No active runs.
                </td>
              </tr>
            ) : null}

            {!loading
              ? rows.map((row) => (
                  <tr key={row.runId}>
                    <td title={row.topicId}>{row.topicId}</td>
                    <td title={row.runId}>{row.runId}</td>
                    <td>
                      <span className={`status-badge status-${row.status}`}>{row.status}</span>
                    </td>
                    <td>{row.currentModule || "-"}</td>
                    <td>{row.awaitingApproval ? "true" : "false"}</td>
                    <td>{formatTime(row.updatedAt)}</td>
                    <td>
                      <button type="button" onClick={() => onOpenRun(row)}>
                        Open User View
                      </button>
                    </td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>
    </section>
  );
};
