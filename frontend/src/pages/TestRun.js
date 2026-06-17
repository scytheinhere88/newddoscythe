import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api from "@/lib/api";
import { ArrowLeft, Square, AlertTriangle, CheckCircle2, XCircle, Activity, ShieldAlert } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts";

function StatusBadge({ s }) {
  const map = {
    queued: { cls: "badge-muted", text: "QUEUED" },
    running: { cls: "", text: "RUNNING", dot: true },
    completed: { cls: "", text: "COMPLETED" },
    failed: { cls: "badge-error", text: "FAILED" },
    aborted: { cls: "badge-warn", text: "ABORTED" },
  };
  const m = map[s] || { cls: "badge-muted", text: s };
  return (
    <span className={`badge-neon ${m.cls}`} data-testid={`test-status-${s}`}>
      {m.dot && <span className="pulse-dot" />}
      {m.text}
    </span>
  );
}

function SeverityIcon({ severity }) {
  if (severity === "high") return <ShieldAlert size={14} className="text-[#ef4444]" />;
  if (severity === "medium") return <AlertTriangle size={14} className="text-[#fbbf24]" />;
  return <CheckCircle2 size={14} className="text-[#39ff14]" />;
}

export default function TestRun() {
  const { id } = useParams();
  const [test, setTest] = useState(null);
  const [points, setPoints] = useState([]);
  const [tick, setTick] = useState(0);
  const pollRef = useRef(null);

  const fetchAll = async () => {
    try {
      const [t, m] = await Promise.all([
        api.get(`/tests/${id}`),
        api.get(`/tests/${id}/metrics`),
      ]);
      setTest(t.data);
      setPoints(m.data.points);
      return t.data.status;
    } catch (e) {
      return "failed";
    }
  };

  useEffect(() => {
    fetchAll();
    pollRef.current = setInterval(async () => {
      const status = await fetchAll();
      setTick((x) => x + 1);
      if (status === "completed" || status === "failed" || status === "aborted") {
        clearInterval(pollRef.current);
      }
    }, 1500);
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line
  }, [id]);

  const abort = async () => {
    if (!confirm("Abort this running test?")) return;
    await api.post(`/tests/${id}/abort`);
    fetchAll();
  };

  if (!test) {
    return <div className="font-mono-display text-gray-500 p-8">$ loading test {id}...</div>;
  }

  const chartData = points.map((p) => ({
    t: new Date(p.ts * 1000).toISOString().slice(14, 19),
    rps: p.rps,
    errors: p.errors,
    p50: p.p50,
    p95: p.p95,
    p99: p.p99,
  }));

  const isLive = test.status === "running" || test.status === "queued";
  const lastPoint = points[points.length - 1];

  return (
    <div className="fade-up" data-testid="test-run-page">
      <Link to="/history" className="font-mono-display text-xs text-gray-500 hover:text-[#39ff14] inline-flex items-center gap-1.5 mb-4">
        <ArrowLeft size={12} /> BACK_TO_HISTORY
      </Link>

      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="min-w-0">
          <div className="font-mono-display text-[10px] text-[#39ff14] tracking-widest mb-2">// TEST_ID: {test.id.slice(-8)}</div>
          <h1 className="font-heading text-3xl text-white tracking-tighter truncate">
            {test.name}{isLive && <span className="cursor-blink" />}
          </h1>
          <div className="font-mono-display text-xs text-gray-500 mt-2 break-all" data-testid="test-target-url">
            <span className="text-gray-600">→ </span>
            <span className="text-gray-300">{test.target_url}</span>
            <span className="ml-3 text-gray-600">·</span>
            <span className="ml-3 uppercase text-[#39ff14]">{test.test_type}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge s={test.status} />
          {isLive && (
            <button onClick={abort} className="btn-danger" data-testid="test-abort-btn">
              <Square size={12} /> ABORT
            </button>
          )}
        </div>
      </div>

      {/* LIVE METRICS */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <MiniStat label="CUR_RPS" value={lastPoint?.rps ?? "—"} accent testid="live-rps" />
        <MiniStat label="ERRORS" value={lastPoint?.errors ?? "—"} testid="live-errors" />
        <MiniStat label="P50" value={lastPoint?.p50 ? `${lastPoint.p50}ms` : "—"} testid="live-p50" />
        <MiniStat label="P95" value={lastPoint?.p95 ? `${lastPoint.p95}ms` : "—"} accent testid="live-p95" />
        <MiniStat label="P99" value={lastPoint?.p99 ? `${lastPoint.p99}ms` : "—"} testid="live-p99" />
      </div>

      {/* RPS Chart */}
      <div className="panel p-5 mb-4" data-testid="chart-rps">
        <div className="flex items-center justify-between mb-3">
          <div className="font-mono-display text-[10px] tracking-widest text-gray-500 uppercase">// REQUESTS_PER_SECOND</div>
          {isLive && <span className="font-mono-display text-[10px] text-[#39ff14]"><span className="pulse-dot mr-2" />LIVE</span>}
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gRps" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#39ff14" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#39ff14" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1f2937" strokeOpacity={0.4} vertical={false} />
            <XAxis dataKey="t" tick={{ fill: "#4b5563", fontSize: 10, fontFamily: "IBM Plex Mono" }} stroke="#1f2937" />
            <YAxis tick={{ fill: "#4b5563", fontSize: 10, fontFamily: "IBM Plex Mono" }} stroke="#1f2937" />
            <Tooltip contentStyle={{ background: "#000", border: "1px solid #39ff14", fontFamily: "IBM Plex Mono", fontSize: 12 }} labelStyle={{ color: "#9ca3af" }} />
            <Area type="monotone" dataKey="rps" stroke="#39ff14" strokeWidth={2} fill="url(#gRps)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Latency Chart */}
      <div className="panel p-5 mb-4" data-testid="chart-latency">
        <div className="font-mono-display text-[10px] tracking-widest text-gray-500 uppercase mb-3">// LATENCY_PERCENTILES (ms)</div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#1f2937" strokeOpacity={0.4} vertical={false} />
            <XAxis dataKey="t" tick={{ fill: "#4b5563", fontSize: 10, fontFamily: "IBM Plex Mono" }} stroke="#1f2937" />
            <YAxis tick={{ fill: "#4b5563", fontSize: 10, fontFamily: "IBM Plex Mono" }} stroke="#1f2937" />
            <Tooltip contentStyle={{ background: "#000", border: "1px solid #39ff14", fontFamily: "IBM Plex Mono", fontSize: 12 }} />
            <Line type="monotone" dataKey="p50" stroke="#9ca3af" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="p95" stroke="#39ff14" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="p99" stroke="#fbbf24" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        <div className="flex gap-4 mt-3 font-mono-display text-[10px] tracking-widest">
          <span className="text-gray-400">━ p50</span>
          <span className="text-[#39ff14]">━ p95</span>
          <span className="text-[#fbbf24]">━ p99</span>
        </div>
      </div>

      {/* Errors chart */}
      <div className="panel p-5 mb-6" data-testid="chart-errors">
        <div className="font-mono-display text-[10px] tracking-widest text-gray-500 uppercase mb-3">// ERRORS / SECOND</div>
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gErr" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1f2937" strokeOpacity={0.4} vertical={false} />
            <XAxis dataKey="t" tick={{ fill: "#4b5563", fontSize: 10, fontFamily: "IBM Plex Mono" }} stroke="#1f2937" />
            <YAxis tick={{ fill: "#4b5563", fontSize: 10, fontFamily: "IBM Plex Mono" }} stroke="#1f2937" />
            <Tooltip contentStyle={{ background: "#000", border: "1px solid #ef4444", fontFamily: "IBM Plex Mono", fontSize: 12 }} />
            <Area type="monotone" dataKey="errors" stroke="#ef4444" strokeWidth={2} fill="url(#gErr)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Summary + Recos */}
      {test.summary && test.status !== "running" && test.status !== "queued" && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6" data-testid="test-summary">
            <MiniStat label="TOTAL_REQ" value={test.summary.total_requests?.toLocaleString()} />
            <MiniStat label="PEAK_RPS" value={test.summary.peak_rps} accent />
            <MiniStat label="ERROR_RATE" value={`${test.summary.error_rate}%`} />
            <MiniStat label="BREAKPOINT" value={test.summary.breakpoint_rps || "—"} />
          </div>

          {/* Status codes */}
          {Object.keys(test.summary.status_codes || {}).length > 0 && (
            <div className="panel p-5 mb-4" data-testid="status-codes">
              <div className="font-mono-display text-[10px] tracking-widest text-gray-500 uppercase mb-3">// STATUS_CODE_DISTRIBUTION</div>
              <div className="flex flex-wrap gap-3 font-mono-display text-sm">
                {Object.entries(test.summary.status_codes).map(([code, count]) => (
                  <div key={code} className="border border-[#1f2937] px-3 py-2">
                    <span className={`mr-2 ${
                      code.startsWith("2") ? "text-[#39ff14]" :
                      code.startsWith("3") ? "text-[#60a5fa]" :
                      code.startsWith("4") ? "text-[#fbbf24]" :
                      "text-[#ef4444]"
                    }`}>{code}</span>
                    <span className="text-gray-400">{count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {test.recommendations && test.recommendations.length > 0 && (
            <div className="panel p-5 mb-4" data-testid="recommendations">
              <div className="font-mono-display text-[10px] tracking-widest text-[#39ff14] uppercase mb-4">
                // SYSTEM_DIAGNOSTICS · HARDENING_RECOMMENDATIONS
              </div>
              <div className="space-y-3">
                {test.recommendations.map((r, i) => (
                  <div key={i} className="border-l-2 border-[#1f2937] pl-4 py-1" data-testid={`reco-${i}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <SeverityIcon severity={r.severity} />
                      <span className="font-mono-display text-xs tracking-widest text-white uppercase">{r.title}</span>
                      <span className={`badge-neon ml-auto ${
                        r.severity === "high" ? "badge-error" :
                        r.severity === "medium" ? "badge-warn" : ""
                      }`}>{r.severity}</span>
                    </div>
                    <div className="text-gray-400 text-sm leading-relaxed pl-6">{r.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Log tail */}
      {test.log_tail && (
        <div className="panel p-5" data-testid="log-tail">
          <div className="font-mono-display text-[10px] tracking-widest text-gray-500 uppercase mb-2">// K6_LOG_TAIL</div>
          <pre className="terminal max-h-60 overflow-auto text-xs whitespace-pre-wrap">{test.log_tail}</pre>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, accent, testid }) {
  return (
    <div className={`panel p-4 ${accent ? "panel-active" : ""}`} data-testid={testid}>
      <div className="font-mono-display text-[10px] tracking-widest text-gray-500 uppercase mb-1.5">{label}</div>
      <div className={`stat-num text-2xl ${accent ? "stat-num-neon" : ""}`}>{value}</div>
    </div>
  );
}
