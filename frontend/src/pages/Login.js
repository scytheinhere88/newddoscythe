import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Terminal, Lock } from "lucide-react";

export default function Login() {
  const { login, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();
  const location = useLocation();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const ok = await login(email, password);
    setLoading(false);
    if (ok) {
      const to = location.state?.from || "/";
      nav(to);
    }
  };

  return (
    <div className="min-h-screen bg-black scanlines grain flex">
      {/* LEFT — terminal login */}
      <div className="w-full md:w-1/2 flex items-center justify-center p-10">
        <div className="w-full max-w-md fade-up" data-testid="login-card">
          <div className="flex items-center gap-2 mb-8">
            <Terminal size={22} className="text-[#39ff14]" strokeWidth={1.5} />
            <span className="font-heading text-white text-xl tracking-tighter">
              RESILIENCE<span className="text-[#39ff14]">.LAB</span>
            </span>
          </div>
          <div className="ascii-div mb-3">┌──────────────────────────────────┐</div>
          <h1 className="font-heading text-3xl text-white mb-1">
            <span className="text-[#39ff14]">$</span> login
            <span className="cursor-blink" />
          </h1>
          <p className="text-gray-500 font-mono-display text-xs tracking-wider mb-8">
            // AUTHORIZED PERSONNEL ONLY · OWNED ASSETS ONLY
          </p>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block font-mono-display text-[10px] tracking-widest text-gray-500 uppercase mb-1.5">
                &gt; email
              </label>
              <input
                data-testid="login-email-input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@domain.com"
                className="input-neon"
              />
            </div>
            <div>
              <label className="block font-mono-display text-[10px] tracking-widest text-gray-500 uppercase mb-1.5">
                &gt; password
              </label>
              <input
                data-testid="login-password-input"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
                className="input-neon"
              />
            </div>

            {error && (
              <div
                data-testid="login-error"
                className="badge-error inline-block w-full text-left font-mono-display text-xs px-3 py-2"
              >
                ! {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              data-testid="login-submit-button"
              className="btn-neon w-full justify-center"
            >
              <Lock size={14} strokeWidth={1.5} />
              {loading ? "AUTHENTICATING..." : "ACCESS_GRANTED →"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link
              to="/register"
              data-testid="login-to-register-link"
              className="font-mono-display text-xs text-gray-500 hover:text-[#39ff14] tracking-wider transition-colors"
            >
              [ no_account? &gt;&gt; register ]
            </Link>
          </div>
          <div className="ascii-div mt-4">└──────────────────────────────────┘</div>
        </div>
      </div>

      {/* RIGHT — visual */}
      <div className="hidden md:block w-1/2 relative border-l border-[#1f2937] overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-50"
          style={{
            backgroundImage:
              "url(https://images.unsplash.com/photo-1581193633211-42cf83aaa734?crop=entropy&cs=srgb&fm=jpg&w=1400&q=70)",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/60 to-transparent" />
        <div className="relative h-full flex items-center p-12">
          <div>
            <div className="font-mono-display text-[10px] text-[#39ff14] tracking-widest mb-2">// MISSION_BRIEF</div>
            <h2 className="font-heading text-5xl text-white leading-tight tracking-tighter mb-6">
              Stress-test<br />
              your stack<br />
              <span className="text-[#39ff14]">before the world does.</span>
            </h2>
            <p className="font-body text-gray-400 max-w-md leading-relaxed">
              Industry-grade load testing via the k6 engine. Realistic
              traffic patterns, p50/p95/p99 latency, breakpoint detection &
              hardening recommendations — all in one terminal-grade dashboard.
            </p>
            <div className="ascii-div mt-8 text-[#39ff14]/60">━━━━ FOR_OWNED_ASSETS_ONLY ━━━━</div>
          </div>
        </div>
      </div>
    </div>
  );
}
