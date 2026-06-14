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

const MODES: { value: NotificationMode; label: string; tone: string; desc: string }[] = [
  { value: "dry_run", label: "Dry run", tone: "border-muted text-muted-foreground", desc: "No provider calls. Every attempt is logged as dry_run." },
  { value: "allowlist", label: "Allowlist", tone: "border-amber-500/30 text-amber-300", desc: "Real sends, but only to allowlisted phones / emails." },
  { value: "live", label: "Live", tone: "border-emerald-500/30 text-emerald-300", desc: "Real sends to every recipient. Use only after QA." },
];

function NotificationModeCard() {
  const qc = useQueryClient();
  const getFn = useServerFn(getJfNotificationSettings);
  const updateFn = useServerFn(updateJfNotificationSettings);
  const { data, isLoading } = useQuery({
    queryKey: ["jf-notif-settings"],
    queryFn: () => getFn(),
    staleTime: 30_000,
  });

  const [mode, setMode] = useState<NotificationMode>("dry_run");
  const [phonesText, setPhonesText] = useState("");
  const [emailsText, setEmailsText] = useState("");

  useEffect(() => {
    if (!data) return;
    setMode(data.mode);
    setPhonesText(data.allowlist_phones.join("\n"));
    setEmailsText(data.allowlist_emails.join("\n"));
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const allowlist_phones = phonesText.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      const allowlist_emails = emailsText.split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      return updateFn({ data: { mode, allowlist_phones, allowlist_emails } });
    },
    onSuccess: () => {
      toast.success("Notification mode saved");
      qc.invalidateQueries({ queryKey: ["jf-notif-settings"] });
      qc.invalidateQueries({ queryKey: ["launch-readiness"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });

  const current = MODES.find((m) => m.value === (data?.mode ?? "dry_run"))!;

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Notification Mode</h2>
          <p className="text-xs text-muted-foreground">Controls whether membership emails / SMS actually send. Read by every membership trigger.</p>
        </div>
        <Badge variant="outline" className={current.tone}>Current: {current.label}</Badge>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMode(m.value)}
                className={`rounded-md border p-3 text-left transition ${mode === m.value ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
              >
                <div className="text-sm font-medium">{m.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">{m.desc}</div>
              </button>
            ))}
          </div>

          <div className={`grid gap-3 sm:grid-cols-2 ${mode === "allowlist" ? "" : "opacity-60"}`}>
            <div className="space-y-1">
              <Label htmlFor="allow-phones" className="text-xs">Allowlist phones (one per line, E.164)</Label>
              <Textarea
                id="allow-phones"
                rows={4}
                placeholder="+15551234567"
                value={phonesText}
                onChange={(e) => setPhonesText(e.target.value)}
                disabled={mode !== "allowlist"}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="allow-emails" className="text-xs">Allowlist emails (one per line)</Label>
              <Textarea
                id="allow-emails"
                rows={4}
                placeholder="staff@example.com"
                value={emailsText}
                onChange={(e) => setEmailsText(e.target.value)}
                disabled={mode !== "allowlist"}
              />
            </div>
          </div>

          {mode === "live" && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
              Live mode sends real messages to every recipient. Confirm QA in Allowlist mode first.
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}