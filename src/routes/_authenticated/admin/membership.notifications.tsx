import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { adminListNotificationAttempts } from "@/lib/launch-readiness.functions";
import {
  getJfNotificationSettings,
  updateJfNotificationSettings,
  type NotificationMode,
} from "@/lib/jf-notification-settings.functions";

export const Route = createFileRoute("/_authenticated/admin/membership/notifications")({
  component: NotifPage,
});

const DECISIONS = ["", "dry_run", "suppressed", "sent", "failed", "skipped"];

function NotifPage() {
  const [decision, setDecision] = useState("");
  const fetch = useServerFn(adminListNotificationAttempts);
  const { data, isLoading } = useQuery({
    queryKey: ["jf-notif-attempts", decision],
    queryFn: () => fetch({ data: { limit: 200, decision: decision || undefined } }),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Notification Attempts" subtitle="Every JF Membership notification, including dry-run and suppressed. Recipients redacted." />
      <NotificationModeCard />
      <Card className="p-3 flex flex-wrap gap-2">
        {DECISIONS.map((d) => (
          <Button key={d || "all"} size="sm" variant={decision === d ? "default" : "outline"} onClick={() => setDecision(d)}>
            {d || "All"}
          </Button>
        ))}
      </Card>
      <Card className="overflow-x-auto p-0">
        {isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        ) : (data?.length ?? 0) === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No attempts.</div>
        ) : (
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">When</th>
                <th className="px-3 py-2 text-left">Trigger</th>
                <th className="px-3 py-2 text-left">Channel</th>
                <th className="px-3 py-2 text-left">Mode</th>
                <th className="px-3 py-2 text-left">Decision</th>
                <th className="px-3 py-2 text-left">Reason</th>
                <th className="px-3 py-2 text-left">Recipient</th>
                <th className="px-3 py-2 text-left">Preview</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data!.map((r: any) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.trigger_key}</td>
                  <td className="px-3 py-2 text-xs">{r.channel}</td>
                  <td className="px-3 py-2 text-xs">{r.mode}</td>
                  <td className="px-3 py-2 text-xs">
                    <Badge variant="outline" className={
                      r.decision === "sent" ? "border-emerald-500/30 text-emerald-300"
                      : r.decision === "failed" ? "border-rose-500/30 text-rose-300"
                      : r.decision === "dry_run" ? "border-amber-500/30 text-amber-300"
                      : "border-muted text-muted-foreground"
                    }>{r.decision}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.reason ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.recipient ?? "—"}</td>
                  <td className="px-3 py-2 text-xs max-w-[260px] truncate" title={r.rendered_body ?? ""}>{r.rendered_body ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}