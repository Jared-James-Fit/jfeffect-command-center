import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMemberDefaults } from "@/lib/members.functions";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle } from "lucide-react";
import { COACHING_FEATURES, DEFAULT_ACCESS_LABELS, type AccountType } from "@/lib/membership";

export function DefaultAccessChecklist({
  accountType,
  overrides,
  onToggleOverride,
}: {
  accountType: AccountType;
  overrides: Set<string>;
  onToggleOverride: (key: string) => void;
}) {
  const list = useServerFn(listMemberDefaults);
  const { data } = useQuery({
    queryKey: ["member-defaults", accountType],
    queryFn: () => list({ data: { accountType } }),
  });
  const keys: string[] = data?.keys ?? [];

  return (
    <Card className="border-emerald-500/30 bg-emerald-500/5 p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wider text-emerald-300/80 font-semibold">Default Access Checklist</div>
          <div className="text-xs text-muted-foreground">
            Auto-applied when the account is created. Uncheck any item to skip it on this member.
          </div>
        </div>
        <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
          {accountType === "jf_member" ? "JF Membership" : accountType}
        </Badge>
      </div>

      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Enabled by default</div>
        {keys.length === 0 && <div className="text-xs text-muted-foreground italic">No defaults configured.</div>}
        {keys.map((k) => {
          const off = overrides.has(k);
          return (
            <label key={k} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-emerald-500/10">
              <Checkbox checked={!off} onCheckedChange={() => onToggleOverride(k)} />
              <CheckCircle2 className={`h-3.5 w-3.5 ${off ? "text-muted-foreground" : "text-emerald-400"}`} />
              <span className={off ? "line-through text-muted-foreground" : ""}>
                {DEFAULT_ACCESS_LABELS[k] ?? k}
              </span>
            </label>
          );
        })}
      </div>

      {accountType === "jf_member" && (
        <div className="space-y-1 pt-2 border-t border-emerald-500/20">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Disabled (coaching only)</div>
          {COACHING_FEATURES.map((f) => (
            <div key={f.key} className="flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground">
              <XCircle className="h-3.5 w-3.5 text-rose-400/70" />
              <span>{f.label}</span>
            </div>
          ))}
          <div className="text-[11px] text-muted-foreground italic mt-2">
            Admin can grant any of these later from the member profile.
          </div>
        </div>
      )}
    </Card>
  );
}