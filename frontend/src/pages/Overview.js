import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { Activity, ServerCrash, FolderTree, Zap, Cpu, Gauge } from "lucide-react";

function StatCard({ label, value, suffix = "", icon: Icon, accent, testid }) {
  return (
    <div className={`panel ${accent ? "panel-active" : ""} p-6 panel-hover`} data-testid={testid}>
      <div className="flex items-center justify-between mb-4">
        <span className="font-mono-display text-[10px] tracking-widest text-gray-500 uppercase">{label}</span>
        <Icon size={16} className={accent ? "text-[#39ff14]" : "text-gray-600"} strokeWidth={1.5} />
      </div>
      <div className={`stat-num text-5xl ${accent ? "stat-num-neon" : ""}`}>
        {value}
        <span className="text-2xl text-gray-600 ml-1">{suffix}</span>
      </div>
    </div>
  );
}

export default function Overview() {
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, t] = await Promise.all([
          api.get("/stats/overview"),
          api.get("/tests"),
        ]);
        setStats(s.data);
        setRecent(t.data.slice(0, 6));
      } catch (e) {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="fade-up" data-testid="overview-page">
      <div className="mb-8">
        <div className="font-mono-display text-[10px] text-[#39ff14] tracking-widest mb-2">// SECTION_01</div>
        <h1 className="font-heading text-4xl text-white tracking-tighter">
          system overview<span className="cursor-blink" />
        </h1>
        <p className="text-gray-500 font-body mt-2 text-sm">
          Real-time intelligence on your test infrastructure.
        </p>
      </div>

      {loading ? (
        <div className="font-mono-display text-gray-500 text-sm">$ loading metrics...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
            <StatCard
              label="Projects"
              value={stats?.projects || 0}
              icon={FolderTree}
              testid="stat-projects"
            />
            <StatCard
              label="Verified"
              value={stats?.verified_projects || 0}
              icon={Zap}
              accent
              testid="stat-verified"
            />
            <StatCard
              label="Total Tests"
              value={stats?.tests_total || 0}
              icon={Activity}
              testid="stat-tests"
            />
            <StatCard
              label="Running Now"
              value={stats?.tests_running || 0}
              icon={Cpu}
              accent={stats?.tests_running > 0}
              testid="stat-running"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-10">
            <StatCard
              label="Peak RPS (recent)"
              value={stats?.peak_rps_recent || 0}
              suffix="req/s"
              icon={Gauge}
              accent
              testid="stat-peak-rps"
            />
            <StatCard
              label="Avg RPS"
              value={stats?.avg_rps_recent || 0}
              suffix="req/s"
              icon={Activity}
              testid="stat-avg-rps"
            />
            <StatCard
              label="Avg Error Rate"
              value={stats?.avg_error_rate_recent || 0}
              suffix="%"
              icon={ServerCrash}
              testid="stat-error-rate"
            />
          </div>

          {/* Limits panel */}
          <div className="panel p-5 mb-10" data-testid="limits-panel">
            <div className="font-mono-display text-[10px] tracking-widest text-gray-500 uppercase mb-3">
              // SAFETY_LIMITS
            </div>
            <div className="grid grid-cols-3 gap-6 font-mono-display text-sm">
              <div>
                <div className="text-gray-500 text-xs">MAX_RPS</div>
                <div className="text-[#39ff14] text-xl mt-1">{stats?.limits?.max_rps?.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-gray-500 text-xs">MAX_DURATION</div>
                <div className="text-[#39ff14] text-xl mt-1">{stats?.limits?.max_duration_sec}s</div>
              </div>
              <div>
                <div className="text-gray-500 text-xs">MAX_VUS</div>
                <div className="text-[#39ff14] text-xl mt-1">{stats?.limits?.max_vus?.toLocaleString()}</div>
              </div>
            </div>
          </div>

          {/* Recent tests */}
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="font-mono-display text-[10px] text-[#39ff14] tracking-widest mb-1">// SECTION_02</div>
              <h2 className="font-heading text-2xl text-white tracking-tighter">recent activity</h2>
            </div>
            <Link to="/history" data-testid="overview-view-all-link" className="btn-ghost">
              VIEW_ALL →
            </Link>
          </div>

          {recent.length === 0 ? (
            <div className="panel p-10 text-center">
              <div className="font-mono-display text-gray-500 text-sm mb-2">// NO_TESTS_YET</div>
              <p className="text-gray-400 mb-5">Add a project, verify ownership, then run your first stress test.</p>
              <Link to="/projects" className="btn-neon" data-testid="overview-add-project-cta">
                + ADD_PROJECT
              </Link>
            </div>
          ) : (
            <div className="panel">
              <table className="w-full" data-testid="recent-tests-table">
                <thead className="border-b border-[#1f2937]">
                  <tr className="font-mono-display text-[10px] tracking-widest text-gray-500 uppercase">
                    <th className="text-left py-3 px-4">Name</th>
                    <th className="text-left py-3 px-4">Type</th>
                    <th className="text-left py-3 px-4">Target</th>
                    <th className="text-left py-3 px-4">Peak RPS</th>
                    <th className="text-left py-3 px-4">p95</th>
                    <th className="text-left py-3 px-4">Errors</th>
                    <th className="text-left py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((t) => (
                    <tr key={t.id} className="border-b border-[#111827] hover:bg-[#0a0a0a]">
                      <td className="py-3 px-4 font-mono-display text-sm">
                        <Link to={`/tests/${t.id}`} className="hover:text-[#39ff14]" data-testid={`recent-test-link-${t.id}`}>
                          {t.name}
                        </Link>
                      </td>
                      <td className="py-3 px-4 font-mono-display text-xs text-gray-400 uppercase">{t.test_type}</td>
                      <td className="py-3 px-4 font-mono-display text-xs text-gray-500 truncate max-w-xs">{t.domain}</td>
                      <td className="py-3 px-4 font-mono-display text-sm text-[#39ff14]">
                        {t.summary?.peak_rps || "—"}
                      </td>
                      <td className="py-3 px-4 font-mono-display text-sm">
                        {t.summary?.p95 ? `${t.summary.p95}ms` : "—"}
                      </td>
                      <td className="py-3 px-4 font-mono-display text-sm">
                        {t.summary?.error_rate != null ? `${t.summary.error_rate}%` : "—"}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`badge-neon ${
                          t.status === "completed" ? "" :
                          t.status === "running" ? "" :
                          t.status === "failed" ? "badge-error" :
                          t.status === "aborted" ? "badge-warn" : "badge-muted"
                        }`}>
                          {t.status === "running" && <span className="pulse-dot" />}
                          {t.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
