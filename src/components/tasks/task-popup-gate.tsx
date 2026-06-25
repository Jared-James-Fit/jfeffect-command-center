import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ListChecks } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { fetchTasks, QUADRANTS, countOpen, type TaskQuadrant, type TaskScope } from "@/lib/tasks";

const KEY_ADMIN = "jf-tasks-popup-seen-day";
const KEY_MM = "jf-tasks-popup-seen-day-mm";
const ENABLED_KEY_ADMIN = "jf-tasks-popup-enabled-admin";
const ENABLED_KEY_MM = "jf-tasks-popup-enabled-mm";

/** Read the enabled flag (default ON if never set). */
export function isTaskPopupEnabled(scope: "admin" | "media_manager"): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = localStorage.getItem(scope === "media_manager" ? ENABLED_KEY_MM : ENABLED_KEY_ADMIN);
    return v == null ? true : v === "1";
  } catch { return true; }
}
export function setTaskPopupEnabled(scope: "admin" | "media_manager", enabled: boolean) {
  try {
    localStorage.setItem(
      scope === "media_manager" ? ENABLED_KEY_MM : ENABLED_KEY_ADMIN,
      enabled ? "1" : "0",
    );
  } catch {}
}

// Mirror of tasks page quadrant styles (color + labels), persisted to localStorage.
type QuadStyle = { color: string; title: string; subtitle: string };
export const DEFAULT_QUAD_STYLES: Record<TaskQuadrant, QuadStyle> = {
  do:        { color: "#22c55e", title: "Do First",  subtitle: "Urgent · Important" },
  schedule:  { color: "#3b82f6", title: "Schedule",  subtitle: "Important · Not Urgent" },
  delegate:  { color: "#eab308", title: "Delegate",  subtitle: "Urgent · Not Important" },
  eliminate: { color: "#ef4444", title: "Eliminate", subtitle: "Not Urgent · Not Important" },
};
const DEFAULT_STYLES = DEFAULT_QUAD_STYLES;
export const QUAD_STYLE_KEY = "jf-quadrant-styles";
export type { QuadStyle };
export function readQuadStyles(): Record<TaskQuadrant, QuadStyle> {
  try {
    const raw = localStorage.getItem(QUAD_STYLE_KEY);
    if (raw) return { ...DEFAULT_STYLES, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_STYLES;
}
export function writeQuadStyles(s: Record<TaskQuadrant, QuadStyle>) {
  try { localStorage.setItem(QUAD_STYLE_KEY, JSON.stringify(s)); } catch {}
}
function tintStyle(color: string): React.CSSProperties {
  return { backgroundColor: `${color}1A`, borderColor: `${color}80` };
}
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Show a one-shot task summary popup the first time an admin/coach (or media manager) lands in their dashboard per day. */
export function TaskPopupGate({ scope = "admin" }: { scope?: "admin" | "media_manager" }) {
  // Daily task summary popup has been disabled across all accounts per product decision.
  // Component intentionally renders nothing; helpers above (isTaskPopupEnabled,
  // readQuadStyles, etc.) remain exported because other surfaces still use them.
  void scope;
  return null;
}