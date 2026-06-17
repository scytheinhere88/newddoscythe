import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { Rocket, AlertTriangle } from "lucide-react";

const SCENARIOS = [
  { value: "smoke", label: "SMOKE", desc: "Tiny 2-VU sanity check. Verifies endpoint works.", defaults: { vus: 2, dur: 30, rps: 5 } },
  { value: "ramp", label: "RAMP", desc: "Gradually ramp up to target, hold, ramp down. Best general test.", defaults: { vus: 50, dur: 90, rps: 50 } },
  { value: "spike", label: "SPIKE", desc: "Sudden traffic burst. Tests autoscale & cache.", defaults: { vus: 100, dur: 60, rps: 100 } },
  { value: "soak", label: "SOAK", desc: "Constant load over long duration. Detects memory leaks.", defaults: { vus: 30, dur: 300, rps: 30 } },
  { value: "stress", label: "STRESS", desc: "Push past expected load to find breaking point.", defaults: { vus: 200, dur: 120, rps: 200 } },
  { value: "breakpoint", label: "BREAKPOINT", desc: "Arrival-rate; finds exact RPS where errors spike.", defaults: { vus: 500, dur: 120, rps: 500 } },
  { value: "burst", label: "BURST", desc: "Short intense bursts. Tests cache hit/miss & autoscaler reaction.", defaults: { vus: 150, dur: 90, rps: 150 } },
  { value: "mixed", label: "MIXED-PATH", desc: "Round-robin across multiple endpoints — realistic user pattern.", defaults: { vus: 50, dur: 120, rps: 50 } },
];

export default function NewTest() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [projects, setProjects] = useState([]);
  const [limits, setLimits] = useState({ max_rps: 5000, max_duration_sec: 600, max_vus: 2000 });
  const [host, setHost] = useState(null);
  const [form, setForm] = useState({
    project_id: params.get("project") || "",
    name: "Test " + new Date().toISOString().slice(11, 16),
    test_type: "ramp",
    target_path: "/",
    method: "GET",
    target_rps: 50,
    duration_sec: 60,
    vus: 50,
    extra_paths: "",
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const [p, s] = await Promise.all([api.get("/projects"), api.get("/stats/overview")]);
      const verified = p.data.filter((x) => x.verified);
      setProjects(verified);
      if (!form.project_id && verified.length) {
        setForm((f) => ({ ...f, project_id: verified[0].id }));
      }
      setLimits(s.data.limits);
      setHost(s.data.host);
    })();
    // eslint-disable-next-line
  }, []);

  const applyScenarioDefaults = (s) => {
    const def = SCENARIOS.find((x) => x.value === s).defaults;
    setForm((f) => ({ ...f, test_type: s, vus: def.vus, duration_sec: def.dur, target_rps: def.rps }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!form.project_id) {
      setErr("Select a verified project first.");
      return;
    }
    setBusy(true);
    try {
      const payload = { ...form };
      if (form.test_type === "mixed" && form.extra_paths) {
        payload.extra_paths = form.extra_paths
          .split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      } else {
        delete payload.extra_paths;
      }
      const { data } = await api.post("/tests", payload);
      nav(`/tests/${data.id}`);
    } catch (er) {
      setErr(formatApiError(er.response?.data?.detail) || er.message);
    } finally {
      setBusy(false);
    }
  };

  const proj = projects.find((p) => p.id === form.project_id);

  return (
    <div className="fade-up" data-testid="new-test-page">
      <div className="mb-8">
        <div className="font-mono-display text-[10px] text-[#39ff14] tracking-widest mb-2">// MODULE_DEPLOY</div>
        <h1 className="font-heading text-4xl text-white tracking-tighter">
          deploy test<span className="cursor-blink" />
        </h1>
        <p className="text-gray-500 font-body mt-2 text-sm">
          Configure scenario · select target · launch k6 engine.
        </p>
      </div>

      {projects.length === 0 ? (
        <div className="panel p-10 text-center" data-testid="new-test-no-verified">
          <AlertTriangle size={32} className="mx-auto text-[#fbbf24] mb-3" strokeWidth={1.5} />
          <h3 className="font-heading text-xl text-white mb-2">No verified projects</h3>
          <p className="text-gray-400 mb-5">You need at least one verified project before deploying a test.</p>
          <button onClick={() => nav("/projects")} className="btn-neon" data-testid="goto-projects-btn">
            GO_TO_PROJECTS →
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT: scenarios */}
          <div className="lg:col-span-2 space-y-6">
            {host && (
              <div className="panel p-4" data-testid="host-banner">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="font-mono-display text-[10px] tracking-widest text-gray-500 uppercase">
                    // LOAD_GENERATOR_DETECTED
                  </div>
                  <div className="font-mono-display text-xs">
                    <span className="text-gray-500">CPU:</span> <span className="text-[#39ff14]">{host.cpu_logical} cores</span>
                    <span className="text-gray-700 mx-2">·</span>
                    <span className="text-gray-500">RAM:</span> <span className="text-[#39ff14]">{(host.ram_total_mb / 1024).toFixed(1)}GB</span>
                    <span className="text-gray-700 mx-2">·</span>
                    <span className="text-gray-500">REC_MAX:</span> <span className="text-[#39ff14] font-bold">{host.recommended_max_rps.toLocaleString()} RPS</span>
                    <span className="text-gray-700 mx-2">·</span>
                    <span className="text-gray-500">MAX_VUs:</span> <span className="text-[#39ff14]">{host.recommended_max_vus.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            )}
            <div className="panel p-5">
              <div className="font-mono-display text-[10px] tracking-widest text-gray-500 uppercase mb-4">// [01] SCENARIO</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {SCENARIOS.map((s) => (
                  <button
                    type="button"
                    key={s.value}
                    onClick={() => applyScenarioDefaults(s.value)}
                    data-testid={`scenario-${s.value}`}
                    className={`p-3 border text-left transition-all ${
                      form.test_type === s.value
                        ? "border-[#39ff14] bg-[#0a0a0a] shadow-[0_0_16px_rgba(57,255,20,0.1)]"
                        : "border-[#1f2937] bg-[#0a0a0a] hover:border-gray-500"
                    }`}
                  >
                    <div className={`font-mono-display text-xs tracking-widest mb-1 ${
                      form.test_type === s.value ? "text-[#39ff14]" : "text-gray-300"
                    }`}>{s.label}</div>
                    <div className="text-[11px] text-gray-500 leading-snug">{s.desc}</div>
                  </button>
                ))}
              </div>
              {form.test_type === "mixed" && (
                <div className="mt-4">
                  <label className="block font-mono-display text-[10px] tracking-widest text-gray-500 uppercase mb-1.5">&gt; extra paths (one per line or comma-separated)</label>
                  <textarea
                    data-testid="form-extra-paths-input"
                    value={form.extra_paths}
                    onChange={(e) => setForm({ ...form, extra_paths: e.target.value })}
                    className="input-neon"
                    rows={3}
                    placeholder="/about&#10;/api/health&#10;/products"
                  />
                  <div className="font-mono-display text-[10px] text-gray-500 mt-1.5">
                    // Each VU iteration picks one path at random (incl. the main target path).
                  </div>
                </div>
              )}
            </div>

            <div className="panel p-5">
              <div className="font-mono-display text-[10px] tracking-widest text-gray-500 uppercase mb-4">// [02] TARGET</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block font-mono-display text-[10px] tracking-widest text-gray-500 uppercase mb-1.5">&gt; project</label>
                  <select
                    data-testid="form-project-select"
                    required
                    value={form.project_id}
                    onChange={(e) => setForm({ ...form, project_id: e.target.value })}
                    className="input-neon"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{`${p.name} — ${p.domain}`}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-mono-display text-[10px] tracking-widest text-gray-500 uppercase mb-1.5">&gt; method</label>
                  <select
                    data-testid="form-method-select"
                    value={form.method}
                    onChange={(e) => setForm({ ...form, method: e.target.value })}
                    className="input-neon"
                  >
                    <option>GET</option><option>HEAD</option><option>POST</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block font-mono-display text-[10px] tracking-widest text-gray-500 uppercase mb-1.5">&gt; endpoint path</label>
                  <input
                    data-testid="form-path-input"
                    value={form.target_path}
                    onChange={(e) => setForm({ ...form, target_path: e.target.value })}
                    className="input-neon"
                    placeholder="/api/health"
                  />
                  {proj && (
                    <div className="font-mono-display text-xs text-gray-500 mt-2 break-all">
                      → <span className="text-[#39ff14]">https://{proj.domain}{form.target_path.startsWith("/") ? form.target_path : "/" + form.target_path}</span>
                    </div>
                  )}
                </div>
                <div className="md:col-span-2">
                  <label className="block font-mono-display text-[10px] tracking-widest text-gray-500 uppercase mb-1.5">&gt; test label</label>
                  <input
                    data-testid="form-name-input"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="input-neon"
                  />
                </div>
              </div>
            </div>

            <div className="panel p-5">
              <div className="font-mono-display text-[10px] tracking-widest text-gray-500 uppercase mb-4">// [03] LOAD PROFILE</div>
              <div className="space-y-5">
                <SliderRow
                  label="VIRTUAL_USERS (VUs)"
                  testid="form-vus"
                  value={form.vus}
                  min={1}
                  max={limits.max_vus}
                  onChange={(v) => setForm({ ...form, vus: v })}
                />
                <SliderRow
                  label="TARGET_RPS"
                  testid="form-rps"
                  value={form.target_rps}
                  min={1}
                  max={limits.max_rps}
                  onChange={(v) => setForm({ ...form, target_rps: v })}
                  hint="Only used by BREAKPOINT scenario; other types are VU-driven."
                />
                <SliderRow
                  label="DURATION (sec)"
                  testid="form-duration"
                  value={form.duration_sec}
                  min={5}
                  max={limits.max_duration_sec}
                  onChange={(v) => setForm({ ...form, duration_sec: v })}
                />
              </div>
            </div>

            {err && (
              <div className="badge-error block px-4 py-3 font-mono-display text-xs" data-testid="new-test-error">
                ! {err}
              </div>
            )}
          </div>

          {/* RIGHT: summary */}
          <div className="lg:col-span-1">
            <div className="panel-active p-5 sticky top-6" data-testid="new-test-summary">
              <div className="font-mono-display text-[10px] tracking-widest text-[#39ff14] uppercase mb-4">// LAUNCH_SUMMARY</div>
              <dl className="space-y-3 font-mono-display text-sm">
                <SumRow k="SCENARIO" v={form.test_type.toUpperCase()} />
                <SumRow k="TARGET" v={proj?.domain || "—"} />
                <SumRow k="PATH" v={form.target_path} />
                <SumRow k="METHOD" v={form.method} />
                <SumRow k="VUS" v={form.vus} />
                <SumRow k="DURATION" v={`${form.duration_sec}s`} />
                {form.test_type === "breakpoint" && <SumRow k="TARGET_RPS" v={form.target_rps} />}
              </dl>
              <div className="ascii-div my-4">━━━━━━━━━━━━━━━━━━━━━</div>
              <div className="text-[11px] text-gray-500 font-mono-display leading-relaxed mb-4">
                // FOR_OWNED_ASSETS_ONLY<br />
                // Project must be DNS-verified.<br />
                // Hard cap: {limits.max_rps} RPS / {limits.max_duration_sec}s.
              </div>
              <button
                type="submit"
                disabled={busy || !form.project_id}
                className="btn-neon w-full justify-center text-base py-3"
                data-testid="new-test-deploy-btn"
              >
                <Rocket size={14} strokeWidth={1.5} />
                {busy ? "DEPLOYING..." : "DEPLOY_TEST →"}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

function SumRow({ k, v }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500 text-[10px] tracking-widest">{k}</span>
      <span className="text-white">{v}</span>
    </div>
  );
}

function SliderRow({ label, value, min, max, onChange, testid, hint }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="font-mono-display text-[10px] tracking-widest text-gray-500 uppercase">&gt; {label}</label>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Math.max(min, Math.min(max, parseInt(e.target.value) || min)))}
          className="bg-[#0a0a0a] border border-[#1f2937] text-[#39ff14] font-mono-display text-sm px-2 py-1 w-24 text-right focus:border-[#39ff14] outline-none"
          data-testid={`${testid}-input`}
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full accent-[#39ff14]"
        data-testid={`${testid}-slider`}
      />
      <div className="flex justify-between text-[10px] text-gray-600 font-mono-display mt-1">
        <span>{min}</span><span>{max.toLocaleString()}</span>
      </div>
      {hint && <div className="text-[10px] text-gray-500 mt-1.5 italic">// {hint}</div>}
    </div>
  );
}
