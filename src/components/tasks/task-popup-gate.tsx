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
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [styles, setStyles] = useState<Record<TaskQuadrant, QuadStyle>>(DEFAULT_STYLES);

  // Per-user storage so "seen today" never leaks across accounts on the same browser.
  const baseKey = scope === "media_manager" ? KEY_MM : KEY_ADMIN;
  const storageKey = user?.id ? `${baseKey}:${user.id}` : baseKey;
  const allowed = scope === "media_manager"
    ? (role === "media_manager" || role === "admin")
    : (role === "admin" || role === "coach");
  const enabled = isTaskPopupEnabled(scope);

  // Has this user already dismissed the popup today?
  const [seenToday, setSeenToday] = useState(true);
  useEffect(() => {
    if (!user || !allowed || !enabled) { setSeenToday(true); return; }
    try { setSeenToday(localStorage.getItem(storageKey) === todayKey()); }
    catch { setSeenToday(false); }
  }, [user, allowed, storageKey, enabled]);

  const dbScope: TaskScope = scope === "media_manager" ? "media" : "admin";
  // Fetch tasks up front so we can decide whether opening the popup is even useful.
  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", dbScope, user?.id ?? null],
    queryFn: () => fetchTasks(dbScope),
    enabled: !!user && allowed && enabled && !seenToday,
    staleTime: 60_000,
  });

  const skipForToday = () => {
    try { localStorage.setItem(storageKey, todayKey()); } catch {}
    setSeenToday(true);
    setOpen(false);
  };

  // For MM, only show tasks assigned to them. Admin sees everything.
  const scopedTasks = useMemo(() => {
    if (scope !== "media_manager" || !user?.id) return tasks;
    return tasks.filter((t) => t.assigned_to === user.id);
  }, [tasks, scope, user?.id]);

  const openCount = countOpen(scopedTasks);

  // Only surface the popup when there is at least one open task in the user's scope
  // AND they haven't already dismissed it today. Otherwise it's just noise.
  useEffect(() => {
    if (!user || !allowed || !enabled || seenToday) return;
    if (openCount > 0 && !open) {
      setOpen(true);
      setStyles(readQuadStyles());
    }
  }, [user, allowed, enabled, seenToday, openCount, open]);

  const counts = QUADRANTS.map((q) => ({
    q,
    n: scopedTasks.filter((t) => t.status === "open" && t.quadrant === (q.key as TaskQuadrant)).length,
  }));

  return (
    <Dialog
      // Non-modal: keep the sidebar and the rest of the UI clickable while
      // the daily task summary is on screen. Otherwise the modal overlay
      // captures every click and makes the app feel broken.
      modal={false}
      open={open}
      onOpenChange={(o) => { if (!o) skipForToday(); else setOpen(true); }}
    >
      <DialogContent
        className="max-w-md"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-primary" />
            Your Tasks
            <Badge variant="outline">{openCount} open</Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {counts.map(({ q, n }) => {
            const s = styles[q.key as TaskQuadrant];
            return (
              <div key={q.key} className="rounded-md border p-3" style={tintStyle(s.color)}>
                <div className="text-xs font-bold" style={{ color: s.color }}>{s.title}</div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{s.subtitle}</div>
                <div className="mt-1 text-2xl font-black">{n}</div>
              </div>
            );
          })}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setOpen(false);
              navigate({ to: scope === "media_manager" ? "/media/action-items" : "/admin/tasks" });
            }}
          >
            {scope === "media_manager" ? "Open Action Items" : "Open Task Manager"}
          </Button>
          <Button size="lg" className="text-base font-bold" onClick={skipForToday}>
            Get First Win
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}