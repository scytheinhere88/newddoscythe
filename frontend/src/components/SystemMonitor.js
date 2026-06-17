import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Cpu, MemoryStick, Activity } from "lucide-react";

export default function SystemMonitor() {
  const [live, setLive] = useState(null);

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const { data } = await api.get("/system/live");
        if (mounted) setLive(data);
      } catch (_) {}
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  if (!live) {
    return (
      <div className="font-mono-display text-[10px] text-gray-600 tracking-widest">
        $ probing...
      </div>
    );
  }

  const cpuColor = live.cpu_avg > 85 ? "text-[#ef4444]" : live.cpu_avg > 65 ? "text-[#fbbf24]" : "text-[#39ff14]";
  const ramColor = live.ram_pct > 85 ? "text-[#ef4444]" : live.ram_pct > 65 ? "text-[#fbbf24]" : "text-[#39ff14]";

  return (
    <div className="flex items-center gap-5 font-mono-display text-[10px] tracking-widest" data-testid="system-monitor">
      <div className="flex items-center gap-1.5" data-testid="monitor-cpu">
        <Cpu size={11} className="text-gray-500" strokeWidth={1.5} />
        <span className="text-gray-500">CPU</span>
        <span className={cpuColor}>{live.cpu_avg.toFixed(1)}%</span>
        <span className="text-gray-700">[{live.cpu_per_core.length}c]</span>
      </div>
      <div className="flex items-center gap-1.5" data-testid="monitor-ram">
        <MemoryStick size={11} className="text-gray-500" strokeWidth={1.5} />
        <span className="text-gray-500">RAM</span>
        <span className={ramColor}>{live.ram_pct}%</span>
        <span className="text-gray-700">{(live.ram_used_mb / 1024).toFixed(1)}/{(live.ram_total_mb / 1024).toFixed(0)}GB</span>
      </div>
      <div className="flex items-center gap-1.5" data-testid="monitor-load">
        <Activity size={11} className="text-gray-500" strokeWidth={1.5} />
        <span className="text-gray-500">LOAD</span>
        <span className="text-gray-300">{live.load_1.toFixed(2)} {live.load_5.toFixed(2)} {live.load_15.toFixed(2)}</span>
      </div>
      {live.running_tests > 0 && (
        <div className="flex items-center gap-1.5" data-testid="monitor-running">
          <span className="pulse-dot" />
          <span className="text-[#39ff14]">{live.running_tests} ACTIVE</span>
        </div>
      )}
    </div>
  );
}
