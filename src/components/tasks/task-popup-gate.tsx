import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ListChecks } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { fetchTasks, QUADRANTS, countOpen, type TaskQuadrant } from "@/lib/tasks";

const KEY = "jf-tasks-popup-seen-day";

// Mirror of tasks page quadrant styles (color + labels), persisted to localStorage.
type QuadStyle = { color: string; title: string; subtitle: string };
const DEFAULT_STYLES: Record<TaskQuadrant, QuadStyle> = {
  do:        { color: "#22c55e", title: "Do First",  subtitle: "Urgent · Important" },
  schedule:  { color: "#3b82f6", title: "Schedule",  subtitle: "Important · Not Urgent" },
  delegate:  { color: "#eab308", title: "Delegate",  subtitle: "Urgent · Not Important" },
  eliminate: { color: "#ef4444", title: "Eliminate", subtitle: "Not Urgent · Not Important" },
};
const QUAD_STYLE_KEY = "jf-quadrant-styles";
function readQuadStyles(): Record<TaskQuadrant, QuadStyle> {
  try {
    const raw = localStorage.getItem(QUAD_STYLE_KEY);
    if (raw) return { ...DEFAULT_STYLES, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_STYLES;
}
function tintStyle(color: string): React.CSSProperties {
  return { backgroundColor: `${color}1A`, borderColor: `${color}80` };
}
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Show a one-shot task summary popup the first time an admin/coach lands in /admin per session. */
export function TaskPopupGate() {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [styles, setStyles] = useState<Record<TaskQuadrant, QuadStyle>>(DEFAULT_STYLES);

  useEffect(() => {
    if (!user || (role !== "admin" && role !== "coach")) return;
    try {
      if (localStorage.getItem(KEY) === todayKey()) return;
      setOpen(true);
      setStyles(readQuadStyles());
    } catch {}
  }, [user, role]);

  const skipForToday = () => {
    try { localStorage.setItem(KEY, todayKey()); } catch {}
    setOpen(false);
  };

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: fetchTasks,
    enabled: open,
  });

  const openCount = countOpen(tasks);
  const counts = QUADRANTS.map((q) => ({
    q,
    n: tasks.filter((t) => t.status === "open" && t.quadrant === (q.key as TaskQuadrant)).length,
  }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
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
            onClick={() => { setOpen(false); navigate({ to: "/admin/tasks" }); }}
          >
            Open Task Manager
          </Button>
          <Button size="lg" className="text-base font-bold" onClick={skipForToday}>
            Get First Win
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}