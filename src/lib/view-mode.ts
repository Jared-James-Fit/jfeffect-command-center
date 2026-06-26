import { useEffect, useState } from "react";

export type ViewMode = "staff" | "client";
const KEY_PREFIX = "jf:view-mode:";
const EVENT = "jf-view-mode-change";

function key(uid: string) { return KEY_PREFIX + uid; }

export function getViewMode(uid: string | null | undefined): ViewMode | null {
  if (!uid || typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(key(uid));
    return v === "client" || v === "staff" ? v : null;
  } catch { return null; }
}

export function setViewMode(uid: string, mode: ViewMode) {
  try { localStorage.setItem(key(uid), mode); } catch {}
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { uid, mode } })); } catch {}
}

export function useViewMode(uid: string | null | undefined): [ViewMode | null, (m: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode | null>(() => getViewMode(uid));
  useEffect(() => { setMode(getViewMode(uid)); }, [uid]);
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as { uid: string; mode: ViewMode } | undefined;
      if (!uid) return;
      if (!detail || detail.uid === uid) setMode(getViewMode(uid));
    };
    window.addEventListener(EVENT, onChange as EventListener);
    window.addEventListener("storage", onChange as EventListener);
    return () => {
      window.removeEventListener(EVENT, onChange as EventListener);
      window.removeEventListener("storage", onChange as EventListener);
    };
  }, [uid]);
  return [mode, (m: ViewMode) => { if (uid) { setViewMode(uid, m); setMode(m); } }];
}