import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Terminal, UserPlus } from "lucide-react";

export default function Register() {
  const { register, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const ok = await register(email, password, name);
    setLoading(false);
    if (ok) nav("/");
  };

  return (
    <div className="min-h-screen bg-black scanlines grain flex items-center justify-center p-10">
      <div className="w-full max-w-md fade-up" data-testid="register-card">
        <div className="flex items-center gap-2 mb-8">
          <Terminal size={22} className="text-[#39ff14]" strokeWidth={1.5} />
          <span className="font-heading text-white text-xl tracking-tighter">
            RESILIENCE<span className="text-[#39ff14]">.LAB</span>
          </span>
        </div>
        <div className="ascii-div mb-3">┌──────────────────────────────────┐</div>
        <h1 className="font-heading text-3xl text-white mb-1">
          <span className="text-[#39ff14]">$</span> useradd<span className="cursor-blink" />
        </h1>
        <p className="text-gray-500 font-mono-display text-xs tracking-wider mb-8">
          // CREATE_NEW_OPERATOR_PROFILE
        </p>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block font-mono-display text-[10px] tracking-widest text-gray-500 uppercase mb-1.5">&gt; name (optional)</label>
            <input
              data-testid="register-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="operator_01"
              className="input-neon"
            />
          </div>
          <div>
            <label className="block font-mono-display text-[10px] tracking-widest text-gray-500 uppercase mb-1.5">&gt; email</label>
            <input
              data-testid="register-email-input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@domain.com"
              className="input-neon"
            />
          </div>
          <div>
            <label className="block font-mono-display text-[10px] tracking-widest text-gray-500 uppercase mb-1.5">&gt; password (min 6)</label>
            <input
              data-testid="register-password-input"
              type="password"
              minLength={6}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••"
              className="input-neon"
            />
          </div>

          {error && (
            <div data-testid="register-error" className="badge-error w-full block px-3 py-2 font-mono-display text-xs">
              ! {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            data-testid="register-submit-button"
            className="btn-neon w-full justify-center"
          >
            <UserPlus size={14} strokeWidth={1.5} />
            {loading ? "CREATING..." : "INITIALIZE_PROFILE →"}
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link
            to="/login"
            data-testid="register-to-login-link"
            className="font-mono-display text-xs text-gray-500 hover:text-[#39ff14] tracking-wider transition-colors"
          >
            [ have_account? &gt;&gt; login ]
          </Link>
        </div>
        <div className="ascii-div mt-4">└──────────────────────────────────┘</div>
      </div>
    </div>
  );
}
