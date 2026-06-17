import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { Plus, Trash2, Shield, ShieldCheck, Copy, Check, X, RefreshCw, FileCode, Globe, Server } from "lucide-react";

const METHODS = [
  { id: "http_file", label: "HTTP FILE", icon: FileCode, time: "~30 sec", desc: "Upload a single text file to your webroot" },
  { id: "html_meta", label: "HTML META", icon: Globe, time: "~1 min", desc: "Add one <meta> tag to your homepage" },
  { id: "dns", label: "DNS TXT", icon: Server, time: "1-5 min", desc: "Add a DNS TXT record (most universal)" },
];

export default function Projects() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", domain: "", description: "" });
  const [err, setErr] = useState("");
  const [verifyOf, setVerifyOf] = useState(null);
  const [verifyMethod, setVerifyMethod] = useState("http_file");
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [copied, setCopied] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/projects");
      setItems(data);
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      await api.post("/projects", form);
      setForm({ name: "", domain: "", description: "" });
      setOpen(false);
      load();
    } catch (er) {
      setErr(formatApiError(er.response?.data?.detail) || er.message);
    }
  };

  const remove = async (id) => {
    if (!confirm("Delete this project and all its tests?")) return;
    await api.delete(`/projects/${id}`);
    load();
  };

  const openVerify = (p) => { setVerifyOf(p); setVerifyResult(null); setVerifyMethod("http_file"); };
  const closeVerify = () => { setVerifyOf(null); setVerifyResult(null); };

  const runVerify = async () => {
    setVerifyBusy(true);
    setVerifyResult(null);
    try {
      const { data } = await api.post(`/projects/${verifyOf.id}/verify?method=${verifyMethod}`);
      setVerifyResult(data);
      if (data.verified) {
        setTimeout(() => { load(); closeVerify(); }, 1500);
      }
    } catch (er) {
      setVerifyResult({ verified: false, message: formatApiError(er.response?.data?.detail) });
    } finally {
      setVerifyBusy(false);
    }
  };

  const copyText = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 1500);
  };

  return (
    <div className="fade-up" data-testid="projects-page">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <div className="font-mono-display text-[10px] text-[#39ff14] tracking-widest mb-2">// MODULE_PROJECTS</div>
          <h1 className="font-heading text-4xl text-white tracking-tighter">
            projects<span className="cursor-blink" />
          </h1>
          <p className="text-gray-500 font-body mt-2 text-sm">
            Register and verify the domains you own. 3 quick verification methods — pick the easiest for your stack.
          </p>
        </div>
        <button onClick={() => setOpen(true)} className="btn-neon" data-testid="projects-add-button">
          <Plus size={14} strokeWidth={1.5} /> NEW_PROJECT
        </button>
      </div>

      {loading ? (
        <div className="font-mono-display text-gray-500">$ loading projects...</div>
      ) : items.length === 0 ? (
        <div className="panel p-12 text-center" data-testid="projects-empty">
          <div className="font-mono-display text-gray-500 text-sm mb-3">// EMPTY_REGISTRY</div>
          <p className="text-gray-400 mb-5">No projects yet. Add your first owned domain to start.</p>
          <button onClick={() => setOpen(true)} className="btn-neon" data-testid="projects-empty-cta">
            <Plus size={14} /> ADD_FIRST_PROJECT
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="projects-grid">
          {items.map((p) => (
            <div key={p.id} className={`panel p-5 panel-hover ${p.verified ? "panel-active" : ""}`} data-testid={`project-card-${p.id}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0 flex-1">
                  <div className="font-heading text-lg text-white truncate">{p.name}</div>
                  <div className="font-mono-display text-xs text-gray-500 truncate mt-0.5">{p.domain}</div>
                </div>
                {p.verified ? (
                  <span className="badge-neon" data-testid={`project-verified-${p.id}`}>
                    <ShieldCheck size={10} /> VERIFIED
                  </span>
                ) : (
                  <span className="badge-warn badge-neon" data-testid={`project-unverified-${p.id}`}>
                    <Shield size={10} /> UNVERIFIED
                  </span>
                )}
              </div>
              {p.description && (
                <div className="text-gray-400 text-sm mb-3 line-clamp-2">{p.description}</div>
              )}
              <div className="ascii-div my-3">─────────────────────────</div>
              <div className="grid grid-cols-2 gap-3 font-mono-display text-xs mb-4">
                <div>
                  <div className="text-gray-600">TESTS_RUN</div>
                  <div className="text-white text-lg">{p.test_count || 0}</div>
                </div>
                <div>
                  <div className="text-gray-600">LAST_TEST</div>
                  <div className="text-gray-400 text-xs mt-1.5">
                    {p.last_test_at ? new Date(p.last_test_at).toISOString().slice(0, 16).replace("T", " ") : "—"}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                {!p.verified && (
                  <button onClick={() => openVerify(p)} className="btn-neon flex-1 justify-center" data-testid={`project-verify-btn-${p.id}`}>
                    <Shield size={12} /> VERIFY
                  </button>
                )}
                {p.verified && (
                  <Link to={`/tests/new?project=${p.id}`} className="btn-neon flex-1 justify-center" data-testid={`project-test-btn-${p.id}`}>
                    RUN_TEST →
                  </Link>
                )}
                <button onClick={() => remove(p.id)} className="btn-danger" data-testid={`project-delete-btn-${p.id}`}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {open && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="panel max-w-lg w-full p-6 fade-up" onClick={(e) => e.stopPropagation()} data-testid="project-create-modal">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-heading text-2xl text-white">
                <span className="text-[#39ff14]">$</span> mkdir project
              </h2>
              <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white"><X size={18} /></button>
            </div>
            <form onSubmit={create} className="space-y-4">
              <div>
                <label className="block font-mono-display text-[10px] tracking-widest text-gray-500 uppercase mb-1.5">&gt; project name</label>
                <input data-testid="project-name-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-neon" placeholder="My Production Site" />
              </div>
              <div>
                <label className="block font-mono-display text-[10px] tracking-widest text-gray-500 uppercase mb-1.5">&gt; domain (without protocol)</label>
                <input data-testid="project-domain-input" required value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} className="input-neon" placeholder="example.com" />
              </div>
              <div>
                <label className="block font-mono-display text-[10px] tracking-widest text-gray-500 uppercase mb-1.5">&gt; description (optional)</label>
                <input data-testid="project-description-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input-neon" placeholder="Notes about this project..." />
              </div>
              {err && <div className="badge-error block px-3 py-2 font-mono-display text-xs" data-testid="project-create-error">! {err}</div>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setOpen(false)} className="btn-ghost flex-1">CANCEL</button>
                <button type="submit" className="btn-neon flex-1 justify-center" data-testid="project-create-submit">CREATE →</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Verify modal — multi-method */}
      {verifyOf && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={closeVerify}>
          <div className="panel max-w-2xl w-full p-6 fade-up max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="project-verify-modal">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="font-heading text-2xl text-white"><span className="text-[#39ff14]">$</span> verify ownership</h2>
                <div className="font-mono-display text-xs text-gray-500 mt-1">// DOMAIN: <span className="text-white">{verifyOf.domain}</span></div>
              </div>
              <button onClick={closeVerify} className="text-gray-500 hover:text-white"><X size={18} /></button>
            </div>

            {/* Method tabs */}
            <div className="grid grid-cols-3 gap-2 mb-5" data-testid="verify-method-tabs">
              {METHODS.map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.id}
                    onClick={() => { setVerifyMethod(m.id); setVerifyResult(null); }}
                    data-testid={`verify-method-${m.id}`}
                    className={`p-3 border text-left transition-all ${
                      verifyMethod === m.id
                        ? "border-[#39ff14] bg-[#0a0a0a] shadow-[0_0_16px_rgba(57,255,20,0.1)]"
                        : "border-[#1f2937] bg-[#0a0a0a] hover:border-gray-500"
                    }`}
                  >
                    <Icon size={14} className={verifyMethod === m.id ? "text-[#39ff14]" : "text-gray-500"} strokeWidth={1.5} />
                    <div className={`font-mono-display text-xs tracking-widest mt-2 ${verifyMethod === m.id ? "text-[#39ff14]" : "text-gray-300"}`}>{m.label}</div>
                    <div className="text-[10px] text-gray-500 mt-1">{m.time} · {m.desc}</div>
                  </button>
                );
              })}
            </div>

            {/* Instructions per method */}
            {verifyMethod === "http_file" && (
              <div className="mb-5">
                <ol className="space-y-3 mb-3">
                  <li className="font-body text-gray-300">
                    <span className="font-mono-display text-[#39ff14] mr-2">[01]</span>
                    Create a file at this URL (path: <span className="font-mono-display text-white">/.well-known/resilience-challenge.txt</span>):
                  </li>
                </ol>
                <div className="terminal mb-3">
                  <div><span className="text-gray-500">url:</span> https://{verifyOf.domain}/.well-known/resilience-challenge.txt</div>
                </div>
                <ol className="space-y-3 mb-3">
                  <li className="font-body text-gray-300">
                    <span className="font-mono-display text-[#39ff14] mr-2">[02]</span>
                    File content (a single line, just paste the token):
                  </li>
                </ol>
                <div className="terminal flex items-start justify-between gap-3" data-testid="verify-http-token-block">
                  <div className="break-all">{verifyOf.verify_token}</div>
                  <button onClick={() => copyText(verifyOf.verify_token, "http")} className="btn-ghost flex-shrink-0" data-testid="verify-http-copy-btn">
                    {copied === "http" ? <Check size={12} /> : <Copy size={12} />}
                    {copied === "http" ? "COPIED" : "COPY"}
                  </button>
                </div>
              </div>
            )}

            {verifyMethod === "html_meta" && (
              <div className="mb-5">
                <ol className="space-y-3 mb-3">
                  <li className="font-body text-gray-300">
                    <span className="font-mono-display text-[#39ff14] mr-2">[01]</span>
                    Add this <span className="font-mono-display text-white">&lt;meta&gt;</span> tag inside the <span className="font-mono-display text-white">&lt;head&gt;</span> of <span className="text-white">https://{verifyOf.domain}/</span>:
                  </li>
                </ol>
                <div className="terminal flex items-start justify-between gap-3" data-testid="verify-html-meta-block">
                  <div className="break-all">{`<meta name="resilience-verify" content="${verifyOf.verify_token}">`}</div>
                  <button onClick={() => copyText(`<meta name="resilience-verify" content="${verifyOf.verify_token}">`, "meta")} className="btn-ghost flex-shrink-0" data-testid="verify-html-copy-btn">
                    {copied === "meta" ? <Check size={12} /> : <Copy size={12} />}
                    {copied === "meta" ? "COPIED" : "COPY"}
                  </button>
                </div>
              </div>
            )}

            {verifyMethod === "dns" && (
              <div className="mb-5">
                <ol className="space-y-3 mb-3">
                  <li className="font-body text-gray-300">
                    <span className="font-mono-display text-[#39ff14] mr-2">[01]</span>
                    In your DNS provider for <span className="text-white">{verifyOf.domain}</span>, add a new TXT record:
                  </li>
                </ol>
                <div className="terminal" data-testid="verify-dns-block">
                  <div><span className="text-gray-500">type:</span> TXT</div>
                  <div><span className="text-gray-500">host:</span> _resilience.{verifyOf.domain}</div>
                  <div className="flex items-start justify-between gap-3 mt-1">
                    <div className="break-all"><span className="text-gray-500">value:</span> {verifyOf.verify_token}</div>
                    <button onClick={() => copyText(verifyOf.verify_token, "dns")} className="btn-ghost flex-shrink-0" data-testid="verify-dns-copy-btn">
                      {copied === "dns" ? <Check size={12} /> : <Copy size={12} />}
                      {copied === "dns" ? "COPIED" : "COPY"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {verifyResult && (
              <div className={`mb-4 p-3 font-mono-display text-xs ${verifyResult.verified ? "badge-neon" : "badge-error"} block`} data-testid="verify-result">
                {verifyResult.verified ? "✓ " : "✗ "}{verifyResult.message}
                {verifyResult.records_seen && verifyResult.records_seen.length > 0 && (
                  <div className="mt-2 text-gray-400">
                    <div className="text-gray-500">Records seen:</div>
                    {verifyResult.records_seen.map((r, i) => <div key={i} className="break-all">· {r}</div>)}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={closeVerify} className="btn-ghost flex-1">CLOSE</button>
              <button onClick={runVerify} disabled={verifyBusy} className="btn-neon flex-1 justify-center" data-testid="verify-run-btn">
                <RefreshCw size={12} className={verifyBusy ? "animate-spin" : ""} />
                {verifyBusy ? "CHECKING..." : "RUN_CHECK"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
