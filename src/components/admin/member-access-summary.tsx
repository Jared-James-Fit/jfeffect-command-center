import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { applyDefaultMemberAccess } from "@/lib/members.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/action-button";
import { CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { ACCOUNT_TYPES, COACHING_FEATURES, DEFAULT_ACCESS_LABELS, isSubscriptionActive, type AccountType } from "@/lib/membership";

export function MemberAccessSummary({
  member, access,
}: { member: any; access: any[] }) {
  const qc = useQueryClient();
  const applyFn = useServerFn(applyDefaultMemberAccess);
  const apply = useMutation({
    mutationFn: () => applyFn({ data: { memberId: member.id } }),
    onSuccess: (r) => {
      toast.success(`Applied defaults (${r.inserted} added)`);
      qc.invalidateQueries({ queryKey: ["admin-member", member.id] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const now = Date.now();
  const activeKeys = new Set<string>(
    (access || [])
      .filter((a: any) => a.active && (!a.expires_at || Date.parse(a.expires_at) > now))
      .map((a: any) => a.access_level_key),
  );
  const subActive = isSubscriptionActive(member.status);
  const type = (member.account_type as AccountType);
  const typeMeta = ACCOUNT_TYPES[type] ?? { label: type, tone: "" };

  const orderedKeys = [
    "jf_membership","app_membership","program_library","resource_library",
    "nutrition_tools","community","coaching_access","premium_member",
  ];
  const otherKeys = Array.from(activeKeys).filter((k) => !orderedKeys.includes(k));

  return (
    <Card className="border-border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Access Summary</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={typeMeta.tone}>{typeMeta.label}</Badge>
            <Badge variant={subActive ? "default" : "destructive"}>
              Subscription: {member.status} {subActive ? "" : "(restricted)"}
            </Badge>
          </div>
        </div>
        <ActionButton size="sm" variant="outline" onClick={() => apply.mutate()} jobLabel="Applying default access">
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ""`} />
          Apply defaults
        </ActionButton>
      </div>

      <div className="grid gap-1 sm:grid-cols-2">
        {[...orderedKeys, ...otherKeys].map((k) => {
          const on = activeKeys.has(k);
          // For non-JF account types, only show the "Coaching" row if it's actually granted.
          if (!on && !["jf_membership","app_membership","program_library","resource_library","nutrition_tools","community","coaching_access"].includes(k)) return null;
          return (
            <div key={k} className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-2 py-1.5 text-sm">
              {on
                ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                : <XCircle className="h-4 w-4 text-muted-foreground shrink-0" />}
              <span className={on ? "" : "text-muted-foreground"}>
                {DEFAULT_ACCESS_LABELS[k] ?? k}
              </span>
              {!on && <Badge variant="outline" className="ml-auto text-[10px]">disabled</Badge>}
            </div>
          );
        })}
      </div>

      <div className="pt-3 border-t border-border">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Coaching features</div>
        <div className="grid gap-1 sm:grid-cols-2">
          {COACHING_FEATURES.map((f) => {
            const granted = activeKeys.has(f.key) || activeKeys.has("coaching_access");
            return (
              <div key={f.key} className="flex items-center gap-2 px-2 py-1 text-xs">
                {granted
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  : <XCircle className="h-3.5 w-3.5 text-muted-foreground" />}
                <span className={granted ? "" : "text-muted-foreground"}>{f.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}