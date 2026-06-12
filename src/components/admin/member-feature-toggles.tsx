import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { grantAccess, revokeAccess } from "@/lib/members.functions";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { runJob } from "@/lib/progress-jobs";

/**
 * Per-member feature toggles. Lists every access level from `access_levels`
 * and lets an admin flip features on/off with auto-save.
 */
export function MemberFeatureToggles({
  memberId,
  levels,
  access,
}: {
  memberId: string;
  levels: Array<{ key: string; label: string; description?: string | null; sort_order?: number | null }>;
  access: Array<{ id: string; access_level_key: string; active: boolean; expires_at?: string | null; source?: string | null }>;
}) {
  const qc = useQueryClient();
  const grant = useServerFn(grantAccess);
  const revoke = useServerFn(revokeAccess);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");

  const now = Date.now();
  const activeByKey = useMemo(() => {
    const m = new Map<string, Array<{ id: string; source?: string | null }>>();
    for (const a of access) {
      const live = a.active && (!a.expires_at || Date.parse(a.expires_at) > now);
      if (!live) continue;
      const arr = m.get(a.access_level_key) ?? [];
      arr.push({ id: a.id, source: a.source ?? null });
      m.set(a.access_level_key, arr);
    }
    return m;
  }, [access, now]);

  const toggle = (key: string, on: boolean, grants: Array<{ id: string }>) => {
    runJob({
      title: on ? "Enabling feature" : "Disabling feature",
      description: `Updating access for ${key}`,
    }, async () => {
      if (on) {
        await grant({ data: { memberId, accessKey: key, source: "admin_grant" } });
      } else {
        for (const g of grants) await revoke({ data: { accessId: g.id } });
      }
      qc.invalidateQueries({ queryKey: ["admin-member", memberId] });
      toast.success(on ? "Feature enabled" : "Feature disabled");
    });
  };

  const filtered = useMemo(() => {
    const list = [...levels].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    if (!q.trim()) return list;
    const needle = q.trim().toLowerCase();
    return list.filter((l) => l.label.toLowerCase().includes(needle) || l.key.toLowerCase().includes(needle));
  }, [levels, q]);

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Feature toggles</div>
          <div className="text-xs text-muted-foreground mt-1">
            Enable or disable individual features for this member. Changes save automatically.
          </div>
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search features…" className="h-8 max-w-xs" />
      </div>
      <div className="divide-y rounded-md border">
        {filtered.length === 0 && <div className="p-4 text-sm text-muted-foreground">No features match.</div>}
        {filtered.map((lv) => {
          const grants = activeByKey.get(lv.key) ?? [];
          const on = grants.length > 0;
          const isPending = !!pending[lv.key];
          const source = grants[0]?.source ?? null;
          return (
            <div key={lv.key} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium text-sm">{lv.label}</div>
                  <Badge variant="outline" className="text-[10px] font-mono">{lv.key}</Badge>
                  {on && source && <Badge variant="outline" className="text-[10px]">{source}</Badge>}
                </div>
                {lv.description && <div className="text-xs text-muted-foreground mt-0.5">{lv.description}</div>}
              </div>
              <div className="flex items-center gap-2">
                {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                <Switch
                  checked={on}
                  onCheckedChange={(v) => toggle(lv.key, v, grants)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
