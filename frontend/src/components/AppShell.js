import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Terminal, FolderTree, Activity, History, LogOut, Cpu } from "lucide-react";
import SystemMonitor from "@/components/SystemMonitor";

const NAV = [
  { to: "/", label: "OVERVIEW", icon: Cpu },
  { to: "/projects", label: "PROJECTS", icon: FolderTree },
  { to: "/tests/new", label: "NEW TEST", icon: Activity },
  { to: "/history", label: "HISTORY", icon: History },
];

export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  const handleLogout = async () => {
    await logout();
    nav("/login");
  };

  return (
    <div className="min-h-screen flex bg-black scanlines grain">
      {/* SIDEBAR */}
      <aside className="w-64 border-r border-[#1f2937] bg-[#050505] flex flex-col" data-testid="app-sidebar">
        <div className="p-5 border-b border-[#1f2937]">
          <div className="flex items-center gap-2">
            <Terminal size={18} className="text-[#39ff14]" strokeWidth={1.5} />
            <span className="font-heading text-white text-sm tracking-tight">
              RESILIENCE<span className="text-[#39ff14]">.LAB</span>
            </span>
          </div>
          <div className="ascii-div mt-2">━━━━━━━━━━━━━━━━━━━━━</div>
          <div className="text-[10px] text-gray-600 font-mono-display tracking-wider mt-1">
            v0.1.0 · k6 engine
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              data-testid={`nav-${label.toLowerCase().replace(/\s/g, "-")}`}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 font-mono-display text-xs tracking-widest border border-transparent transition-all ${
                  isActive
                    ? "bg-[#0a0a0a] text-[#39ff14] border-[#39ff14]/40 shadow-[0_0_12px_rgba(57,255,20,0.08)]"
                    : "text-gray-500 hover:text-gray-200 hover:bg-[#0a0a0a] hover:border-[#1f2937]"
                }`
              }
            >
              <Icon size={14} strokeWidth={1.5} />
              {label}
              {label === "NEW TEST" && <span className="pulse-dot ml-auto" />}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-[#1f2937]">
          <div className="text-[10px] text-gray-600 font-mono-display tracking-wider mb-1">USER</div>
          <div className="font-mono-display text-xs text-gray-300 truncate" data-testid="user-email">
            {user?.email}
          </div>
          <button
            data-testid="logout-button"
            onClick={handleLogout}
            className="mt-3 w-full btn-ghost flex items-center justify-center gap-2"
          >
            <LogOut size={12} strokeWidth={1.5} /> LOGOUT
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 min-w-0 relative">
        <header className="h-12 border-b border-[#1f2937] flex items-center justify-between px-6 bg-[#050505]">
          <div className="font-mono-display text-[11px] text-gray-500 tracking-widest">
            <span className="text-[#39ff14]">●</span> SYSTEM ONLINE
          </div>
          <SystemMonitor />
        </header>
        <div className="p-8 max-w-[1600px]">{children}</div>
      </main>
    </div>
  );
}
