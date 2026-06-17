import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Overview from "@/pages/Overview";
import Projects from "@/pages/Projects";
import NewTest from "@/pages/NewTest";
import TestRun from "@/pages/TestRun";
import History from "@/pages/History";
import AppShell from "@/components/AppShell";

function Protected({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (user === null) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center font-mono-display text-gray-500" data-testid="auth-loading">
        $ verifying_session<span className="cursor-blink" />
      </div>
    );
  }
  if (user === false) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <AppShell>{children}</AppShell>;
}

function GuestOnly({ children }) {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center font-mono-display text-gray-500">
        $ checking...
      </div>
    );
  }
  if (user) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
            <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
            <Route path="/" element={<Protected><Overview /></Protected>} />
            <Route path="/projects" element={<Protected><Projects /></Protected>} />
            <Route path="/tests/new" element={<Protected><NewTest /></Protected>} />
            <Route path="/tests/:id" element={<Protected><TestRun /></Protected>} />
            <Route path="/history" element={<Protected><History /></Protected>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}
