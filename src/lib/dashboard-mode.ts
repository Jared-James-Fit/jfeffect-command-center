import { useEffect, useState } from "react";

export type DashboardMode = "coaching" | "membership";
const KEY = "jf-dashboard-mode";
const EVENT = "jf-dashboard-mode-change";

export function getDashboardMode(): DashboardMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "membership") return "membership";
  } catch {}
  return "coaching";
}

export function setDashboardMode(mode: DashboardMode) {
  try { localStorage.setItem(KEY, mode); } catch {}
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: mode })); } catch {}
}

export function useDashboardMode(): [DashboardMode, (m: DashboardMode) => void] {
  const [mode, setMode] = useState<DashboardMode>("coaching");
  useEffect(() => {
    setMode(getDashboardMode());
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as DashboardMode | undefined;
      setMode(detail ?? getDashboardMode());
    };
    window.addEventListener(EVENT, onChange as EventListener);
    window.addEventListener("storage", onChange as EventListener);
    return () => {
      window.removeEventListener(EVENT, onChange as EventListener);
      window.removeEventListener("storage", onChange as EventListener);
    };
  }, []);
  return [mode, (m: DashboardMode) => { setDashboardMode(m); setMode(m); }];
}