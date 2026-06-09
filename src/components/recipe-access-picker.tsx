import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";

type ClientRow = { id: string; full_name: string | null; email: string | null };

export function RecipeAccessPicker({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: string[];
  onSave: (ids: string[]) => Promise<void> | void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initial));
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setSelected(new Set(initial));
  }, [open, initial]);

  const { data: clients = [] } = useQuery({
    queryKey: ["recipe-access-clients"],
    enabled: open,
    queryFn: async () => {
      const { data } = await (supabase.from("clients") as any)
        .select("id, full_name, email")
        .eq("archived", false)
        .order("full_name", { ascending: true });
      return (data ?? []) as ClientRow[];
    },
  });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) =>
      [c.full_name, c.email].some((s) => (s ?? "").toLowerCase().includes(q)),
    );
  }, [clients, query]);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected((s) => {
      const next = new Set(s);
      visible.forEach((c) => next.add(c.id));
      return next;
    });
  }

  function clearAll() {
    setSelected(new Set());
  }

  async function save() {
    try {
      setSaving(true);
      await onSave(Array.from(selected));
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Select Clients</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Search clients…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{selected.size} selected</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={selectAllVisible}>Select visible</Button>
              <Button variant="ghost" size="sm" onClick={clearAll}>Clear all</Button>
            </div>
          </div>
          <ScrollArea className="h-72 rounded-md border">
            <div className="divide-y">
              {visible.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-3 p-3 hover:bg-muted/40">
                  <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.full_name ?? "Unnamed"}</div>
                    <div className="truncate text-xs text-muted-foreground">{c.email ?? ""}</div>
                  </div>
                </label>
              ))}
              {!visible.length && (
                <div className="p-6 text-center text-sm text-muted-foreground">No clients found.</div>
              )}
            </div>
          </ScrollArea>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-gradient-primary font-bold">
            Save Access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}