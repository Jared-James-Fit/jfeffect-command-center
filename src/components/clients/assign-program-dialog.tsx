import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProgramStatusBadge } from "@/components/programs/program-status-badge";
import { ProgramAssignmentPlanner } from "@/components/program-planner/ProgramAssignmentPlanner";
import { ChevronLeft, Loader2, Search } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  clientName?: string;
};

export function AssignProgramDialog({ open, onOpenChange, clientId, clientName }: Props) {
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["assign-dialog-templates"],
    enabled: open && !templateId,
    queryFn: async () => (await (supabase as any)
      .from("pl_templates")
      .select("id, name, template_type, weeks, training_focus, tags, payload, updated_at")
      .in("template_type", ["block", "full_prep"])
      .eq("archived", false)
      .order("updated_at", { ascending: false })).data ?? [],
  });

  const filtered = (templates as any[]).filter((t) => {
    if (!q.trim()) return true;
    const hay = `${t.name ?? ""} ${t.training_focus ?? ""} ${(t.tags ?? []).join(" ")}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  const handleOpenChange = (v: boolean) => {
    onOpenChange(v);
    if (!v) setTemplateId(null);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {templateId && (
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setTemplateId(null)} aria-label="Back to library">
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            {templateId ? "Configure Assignment" : "Assign Program"}
          </SheetTitle>
          <SheetDescription>
            {templateId
              ? `Set how this template applies to ${clientName ?? "this client"}.`
              : `Pick a program from your library to assign to ${clientName ?? "this client"}.`}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4">
          {!templateId ? (
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search your library…"
                  className="pl-8"
                />
              </div>

              {isLoading ? (
                <div className="flex h-40 items-center justify-center text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading library…
                </div>
              ) : filtered.length === 0 ? (
                <Card className="p-6 text-center text-sm text-muted-foreground">
                  No templates match your search.
                </Card>
              ) : (
                <ul className="grid gap-2">
                  {filtered.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => setTemplateId(t.id)}
                        className="w-full rounded border border-border bg-secondary/20 p-3 text-left transition hover:bg-secondary/50"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold">{t.name}</div>
                          <ProgramStatusBadge template={t} />
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {t.weeks ? `${t.weeks}w · ` : ""}{t.training_focus ?? "—"}
                          {(t.tags ?? []).length ? ` · ${(t.tags ?? []).join(", ")}` : ""}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <ProgramAssignmentPlanner
              clientId={clientId}
              templateId={templateId}
              onDone={() => handleOpenChange(false)}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}