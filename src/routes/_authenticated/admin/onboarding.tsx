import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/app-shell";
import {
  Smartphone, Bell, ClipboardCheck, Check, ChevronLeft, ChevronRight, MoreHorizontal,
  Mail, Link as LinkIcon, AlertOctagon, Globe,
} from "lucide-react";
import { listOnboardingMembers, onboardingCounts } from "@/lib/onboarding.functions";
import {
  sendSetupReminder, getMemberInstallLink, clearMemberSetupError, setMemberBrowserOnly,
} from "@/lib/onboarding-admin.functions";

export const Route = createFileRoute("/_authenticated/admin/onboarding")({
  component: OnboardingPage,
});

type Filter = "all" | "not_signed_in" | "not_installed" | "setup_incomplete" | "notifications_off" | "errors" | "ready";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All members" },
  { key: "not_signed_in", label: "Never signed in" },
  { key: "not_installed", label: "Not installed" },
  { key: "setup_incomplete", label: "Setup incomplete" },
  { key: "notifications_off", label: "Notifications off" },
  { key: "errors", label: "Has errors" },
  { key: "ready", label: "Fully ready" },
];

const PAGE_SIZE = 25;

function OnboardingPage() {
  const listFn = useServerFn(listOnboardingMembers);
  const countsFn = useServerFn(onboardingCounts);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [reminderFor, setReminderFor] = useState<any | null>(null);

  const { data: counts } = useQuery({
    queryKey: ["admin-onboarding-counts"],
    queryFn: () => countsFn(),
    staleTime: 60_000,
  });

  const { data, isFetching } = useQuery({
    queryKey: ["admin-onboarding", filter, search, page],
    queryFn: () => listFn({ data: { filter, search, limit: PAGE_SIZE, offset: page * PAGE_SIZE } }),
    placeholderData: (p) => p,
  });

  const total = data?.total ?? 0;
  const rows = data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Member Onboarding"
        subtitle="See who's signed in, installed the app, finished setup, and is ready to train."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total members" value={counts?.total ?? "—"} />
        <StatCard label="Never signed in" value={counts?.notSignedIn ?? "—"} tone="warn" />
        <StatCard label="Not installed" value={counts?.notInstalled ?? "—"} />
        <StatCard label="Fully ready" value={counts?.ready ?? "—"} tone="ok" />
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant={filter === f.key ? "default" : "outline"}
              onClick={() => { setFilter(f.key); setPage(0); }}
            >
              {f.label}
              {counts && f.key !== "all" && (
                <span className="ml-2 text-xs opacity-70">
                  {f.key === "not_signed_in" ? counts.notSignedIn
                  : f.key === "not_installed" ? counts.notInstalled
                  : f.key === "setup_incomplete" ? counts.incomplete
                  : f.key === "notifications_off" ? counts.notifOff
                  : f.key === "errors" ? counts.errors
                  : f.key === "ready" ? counts.ready : ""}
                </span>
              )}
            </Button>
          ))}
        </div>
        <div className="mt-3">
          <Input
            placeholder="Search by email or name…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground">
          {isFetching ? "Loading…" : `${total} member${total === 1 ? "" : "s"}`}
        </div>
        <ul className="divide-y divide-border">
          {rows.map((r: any) => (
            <OnboardingRow key={r.id} row={r} onSendReminder={() => setReminderFor(r)} />
          ))}
          {!isFetching && rows.length === 0 && (
            <li className="p-8 text-center text-sm text-muted-foreground">No members match this filter.</li>
          )}
        </ul>
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <div>Page {page + 1} of {totalPages}</div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>

      {reminderFor && (
        <SendReminderDialog
          member={reminderFor}
          onClose={() => setReminderFor(null)}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number | string; tone?: "ok" | "warn" }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${
        tone === "ok" ? "text-emerald-500" : tone === "warn" ? "text-amber-500" : ""
      }`}>
        {value}
      </div>
    </Card>
  );
}

function OnboardingRow({ row, onSendReminder }: { row: any; onSendReminder: () => void }) {
  const signedIn = !!row.last_signed_in_at;
  const installed = !!row.install_detected_at;
  const setupDone = !!row.setup_completed_at;
  const notifOk = row.notifications_status === "granted";
  const hasError = !!row.last_setup_error;
  const browserOnly = !!row.setup_browser_only;

  return (
    <li className="flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{row.full_name || row.email}</span>
          {hasError && <Badge variant="destructive" className="text-[10px]">Error</Badge>}
          {browserOnly && <Badge variant="secondary" className="text-[10px]">Browser only</Badge>}
        </div>
        <div className="truncate text-xs text-muted-foreground">{row.email}</div>
        {hasError && (
          <div className="mt-1 text-[11px] text-rose-400">{row.last_setup_error}</div>
        )}
        {row.last_setup_reminder_at && (
          <div className="mt-1 text-[11px] text-muted-foreground">
            Last reminder: {new Date(row.last_setup_reminder_at).toLocaleString()}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill label={signedIn ? "Signed in" : "Never signed in"} ok={signedIn} icon={Check} />
        <Pill
          label={installed ? `Installed${row.install_platform ? ` · ${row.install_platform}` : ""}` : "Not installed"}
          ok={installed}
          icon={Smartphone}
        />
        <Pill label={setupDone ? "Setup done" : "Setup incomplete"} ok={setupDone} icon={ClipboardCheck} />
        <Pill label={notifOk ? "Notifs on" : "Notifs off"} ok={notifOk} icon={Bell} />
      </div>
      <div className="flex shrink-0 gap-2">
        <Link to="/admin/members/$memberId" params={{ memberId: row.id }}>
          <Button size="sm" variant="outline">View</Button>
        </Link>
        <RowActions row={row} onSendReminder={onSendReminder} />
      </div>
    </li>
  );
}

function RowActions({ row, onSendReminder }: { row: any; onSendReminder: () => void }) {
  const qc = useQueryClient();
  const getLink = useServerFn(getMemberInstallLink);
  const clearError = useServerFn(clearMemberSetupError);
  const setBrowserOnly = useServerFn(setMemberBrowserOnly);

  async function copyLink() {
    try {
      const { url } = await getLink({ data: { memberId: row.id } });
      await navigator.clipboard.writeText(url);
      toast.success("Install link copied", { description: url });
    } catch (e: any) {
      toast.error("Couldn't get link", { description: e?.message ?? String(e) });
    }
  }

  async function doClearError() {
    try {
      await clearError({ data: { memberId: row.id } });
      toast.success("Cleared setup error");
      qc.invalidateQueries({ queryKey: ["admin-onboarding"] });
      qc.invalidateQueries({ queryKey: ["admin-onboarding-counts"] });
    } catch (e: any) {
      toast.error("Failed", { description: e?.message ?? String(e) });
    }
  }

  async function toggleBrowserOnly() {
    try {
      await setBrowserOnly({ data: { memberId: row.id, value: !row.setup_browser_only } });
      toast.success(row.setup_browser_only ? "Browser-only flag removed" : "Marked browser-only");
      qc.invalidateQueries({ queryKey: ["admin-onboarding"] });
    } catch (e: any) {
      toast.error("Failed", { description: e?.message ?? String(e) });
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" aria-label="Member actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={onSendReminder}>
          <Mail className="mr-2 h-4 w-4" /> Send setup reminder…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={copyLink}>
          <LinkIcon className="mr-2 h-4 w-4" /> Copy install link
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {row.last_setup_error && (
          <DropdownMenuItem onClick={doClearError}>
            <AlertOctagon className="mr-2 h-4 w-4" /> Clear setup error
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={toggleBrowserOnly}>
          <Globe className="mr-2 h-4 w-4" />
          {row.setup_browser_only ? "Unmark browser-only" : "Mark browser-only"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SendReminderDialog({ member, onClose }: { member: any; onClose: () => void }) {
  const qc = useQueryClient();
  const sendFn = useServerFn(sendSetupReminder);
  const [email, setEmail] = useState(true);
  const [sms, setSms] = useState(false);
  const [force, setForce] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const phone = member.phone as string | null;
  const smsBlocked = !phone || member.sms_opt_out;

  async function submit() {
    const channels: ("email" | "sms")[] = [];
    if (email) channels.push("email");
    if (sms && !smsBlocked) channels.push("sms");
    if (channels.length === 0) {
      toast.error("Pick at least one channel");
      return;
    }
    setBusy(true);
    try {
      const res = await sendFn({
        data: {
          memberId: member.id,
          channels,
          customNote: note.trim() || undefined,
          force,
        },
      });
      const parts: string[] = [];
      if (res.email && !("skipped" in res.email)) {
        parts.push(res.email.sent ? "email queued" : `email skipped (${res.email.reason})`);
      }
      if (res.sms && !("skipped" in res.sms)) {
        parts.push(res.sms.sent ? "SMS sent" : `SMS skipped (${res.sms.reason})`);
      }
      if (res.ok) toast.success("Reminder sent", { description: parts.join(" · ") });
      else toast.warning("Nothing was sent", { description: parts.join(" · ") || "Try forcing the send." });
      qc.invalidateQueries({ queryKey: ["admin-onboarding"] });
      onClose();
    } catch (e: any) {
      toast.error("Failed", { description: e?.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send setup reminder</DialogTitle>
          <DialogDescription>
            To {member.full_name || member.email}
            {member.last_setup_reminder_at && (
              <span className="ml-1 text-xs text-muted-foreground">
                · last sent {new Date(member.last_setup_reminder_at).toLocaleString()}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={email} onCheckedChange={(v) => setEmail(!!v)} disabled={!member.email} />
            <span>Email {member.email ? `(${member.email})` : "(no email on file)"}</span>
          </label>
          <label className={`flex items-center gap-2 text-sm ${smsBlocked ? "opacity-50" : ""}`}>
            <Checkbox checked={sms} onCheckedChange={(v) => setSms(!!v)} disabled={smsBlocked} />
            <span>
              SMS {phone ? `(${phone})` : "(no phone on file)"}
              {member.sms_opt_out && " — opted out"}
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={force} onCheckedChange={(v) => setForce(!!v)} />
            <span>Force send (ignore 24h dedupe)</span>
          </label>
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              Optional personal note (email only)
            </label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. 'Hey Sam — saw you signed up but haven't opened the app yet…'"
              rows={3}
              maxLength={800}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Sending…" : "Send reminder"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Pill({ label, ok, icon: Icon }: { label: string; ok: boolean; icon: any }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
        ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500" : "border-border text-muted-foreground"
      }`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}