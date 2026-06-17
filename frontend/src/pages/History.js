import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";

export default function History() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/tests");
        setItems(data);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="fade-up" data-testid="history-page">
      <div className="mb-8">
        <div className="font-mono-display text-[10px] text-[#39ff14] tracking-widest mb-2">// MODULE_HISTORY</div>
        <h1 className="font-heading text-4xl text-white tracking-tighter">
          test history<span className="cursor-blink" />
        </h1>
        <p className="text-gray-500 font-body mt-2 text-sm">
          Every test run, every project. {items.length} record{items.length === 1 ? "" : "s"}.
        </p>
      </div>

      {loading ? (
        <div className="font-mono-display text-gray-500">$ loading history...</div>
      ) : items.length === 0 ? (
        <div className="panel p-10 text-center" data-testid="history-empty">
          <div className="font-mono-display text-gray-500 text-sm mb-3">// NO_RECORDS</div>
          <p className="text-gray-400 mb-5">No test runs yet.</p>
          <Link to="/tests/new" className="btn-neon" data-testid="history-deploy-cta">DEPLOY_FIRST_TEST →</Link>
        </div>
      ) : (
        <div className="panel overflow-x-auto" data-testid="history-table">
          <table className="w-full min-w-[900px]">
            <thead className="border-b border-[#1f2937]">
              <tr className="font-mono-display text-[10px] tracking-widest text-gray-500 uppercase">
                <th className="text-left py-3 px-4">Time</th>
                <th className="text-left py-3 px-4">Name</th>
                <th className="text-left py-3 px-4">Type</th>
                <th className="text-left py-3 px-4">Target</th>
                <th className="text-left py-3 px-4">Peak RPS</th>
                <th className="text-left py-3 px-4">p95 (ms)</th>
                <th className="text-left py-3 px-4">Err %</th>
                <th className="text-left py-3 px-4">Status</th>
                <th className="text-left py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} className="border-b border-[#111827] hover:bg-[#0a0a0a]" data-testid={`history-row-${t.id}`}>
                  <td className="py-3 px-4 font-mono-display text-xs text-gray-500">
                    {new Date(t.created_at).toISOString().slice(0, 16).replace("T", " ")}
                  </td>
                  <td className="py-3 px-4 font-mono-display text-sm text-white">{t.name}</td>
                  <td className="py-3 px-4 font-mono-display text-xs text-gray-400 uppercase">{t.test_type}</td>
                  <td className="py-3 px-4 font-mono-display text-xs text-gray-500 truncate max-w-xs">{t.domain}</td>
                  <td className="py-3 px-4 font-mono-display text-sm text-[#39ff14]">{t.summary?.peak_rps ?? "—"}</td>
                  <td className="py-3 px-4 font-mono-display text-sm">{t.summary?.p95 ?? "—"}</td>
                  <td className="py-3 px-4 font-mono-display text-sm">{t.summary?.error_rate != null ? `${t.summary.error_rate}%` : "—"}</td>
                  <td className="py-3 px-4">
                    <span className={`badge-neon ${
                      t.status === "failed" ? "badge-error" :
                      t.status === "aborted" ? "badge-warn" :
                      t.status === "queued" ? "badge-muted" : ""
                    }`}>
                      {t.status === "running" && <span className="pulse-dot" />}
                      {t.status}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <Link to={`/tests/${t.id}`} className="btn-ghost" data-testid={`history-view-${t.id}`}>VIEW →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
