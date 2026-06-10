import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ListChecks } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { fetchTasks, QUADRANTS, countOpen, type TaskQuadrant } from "@/lib/tasks";

const KEY = "jf-tasks-popup-seen";

/** Show a one-shot task summary popup the first time an admin/coach lands in /admin per session. */
export function TaskPopupGate() {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user || (role !== "admin" && role !== "coach")) return;
    try {
      if (sessionStorage.getItem(KEY)) return;
      sessionStorage.setItem(KEY, "1");
      setOpen(true);
    } catch {}
  }, [user, role]);

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
          {counts.map(({ q, n }) => (
            <div key={q.key} className={`rounded-md border p-3 ${q.tone}`}>
              <div className="text-xs font-bold">{q.title}</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{q.subtitle}</div>
              <div className="mt-1 text-2xl font-black">{n}</div>
            </div>
          ))}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setOpen(false); navigate({ to: "/admin/tasks" }); }}
          >
            Open Task Manager
          </Button>
          <Button size="lg" className="text-base font-bold" onClick={() => setOpen(false)}>
            Skip for now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}