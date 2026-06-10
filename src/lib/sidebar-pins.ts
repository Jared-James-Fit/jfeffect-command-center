import { useEffect, useState } from "react";

/**
 * Sidebar pinned shortcuts — per-role list of up to 5 nav `to` paths the
 * user wants surfaced at the very top of the sidebar for one-click access.
 * Storage: localStorage, scope = "admin" | "coach" | "member" | "client".
 */

const KEY = "jf-sidebar-pins-v1";
const EVT = "sidebar-pins-updated";
export const MAX_PINS = 5;

export type PinScope = "admin" | "coach" | "member" | "client";

function storageKey(scope: PinScope) {
  return `${KEY}:${scope}`;
}

export function loadPins(scope: PinScope): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => typeof x === "string").slice(0, MAX_PINS);
  } catch {
    return [];
  }
}

function savePins(scope: PinScope, pins: string[]) {
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(pins.slice(0, MAX_PINS)));
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {}
}

export function clearPins(scope: PinScope) {
  try { localStorage.removeItem(storageKey(scope)); } catch {}
  try { window.dispatchEvent(new CustomEvent(EVT)); } catch {}
}

export function useSidebarPins(scope: PinScope) {
  const [pins, setPins] = useState<string[]>(() => loadPins(scope));

  useEffect(() => {
    const sync = () => setPins(loadPins(scope));
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [scope]);

  const isPinned = (to: string) => pins.includes(to);

  const toggle = (to: string): { pinned: boolean; full: boolean } => {
    const next = [...pins];
    const idx = next.indexOf(to);
    if (idx >= 0) {
      next.splice(idx, 1);
      savePins(scope, next);
      setPins(next);
      return { pinned: false, full: false };
    }
    if (next.length >= MAX_PINS) {
      return { pinned: false, full: true };
    }
    next.push(to);
    savePins(scope, next);
    setPins(next);
    return { pinned: true, full: false };
  };

  const reset = () => {
    clearPins(scope);
    setPins([]);
  };

  return { pins, isPinned, toggle, reset, max: MAX_PINS, count: pins.length };
}

/**
 * Reset everything the user can personalize on the sidebar back to "factory":
 * sidebar density, collapsed sections, and pinned shortcuts. Falls back
 * silently in non-browser contexts.
 */
export function restoreSidebarDefaults(scope: PinScope) {
  try {
    localStorage.removeItem("jf-sidebar-mode");
    localStorage.removeItem("jf-sidebar-collapsed-sections");
    localStorage.removeItem(storageKey(scope));
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(EVT));
    window.dispatchEvent(new StorageEvent("storage"));
  } catch {}
}