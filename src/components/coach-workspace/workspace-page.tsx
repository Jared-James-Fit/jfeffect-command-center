/**
 * A coach's workspace (invite-only pilot): who they coach, who's invited, the
 * team, and seat billing. The server decides every permission; this only
 * shows what the server returned. Off in production until a workspace exists.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  getWorkspaceOverview,
  inviteToWorkspace,
  listMyWorkspaces,
  revokeWorkspaceInvitation,
  setWorkspaceClientStatus,
  startWorkspaceBilling,
} from "@/lib/coach-platform/coach-workspace.functions";
import { STATUS_WORD } from "@/lib/coach-platform/workspace";

export function WorkspacePage({ orgId, onPick }: { orgId?: string; onPick: (id: string) => void }) {
  const list = useServerFn(listMyWorkspaces);
  const mine = useQuery({ queryKey: ["my-workspaces"], queryFn: () => list() });
  if (mine.isLoading) return <Loader2 className="m-4 h-5 w-5 animate-spin" />;
  const ws = mine.data ?? [];
  if (!ws.length) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <PageHeader title="Workspace" />
        <Card className="p-4 text-[14px] text-muted-foreground">
          Coach workspaces are invite-only while I test them with a few coaches. If you've applied, I'll be in touch.
        </Card>
      </div>
    );
  }
  const current = ws.find((w) => w.id === orgId) ?? ws[0];
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-32">
      <PageHeader title={current.name} />
      {ws.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {ws.map((w) => (
            <Button key={w.id} size="sm" variant={w.id === current.id ? "secondary" : "ghost"} onClick={() => onPick(w.id)}>
              {w.name}
            </Button>
          ))}
        </div>
      )}
      <Overview orgId={current.id} />
    </div>
  );
}

function Overview({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const get = useServerFn(getWorkspaceOverview);
  const q = useQuery({ queryKey: ["workspace", orgId], queryFn: () => get({ data: { orgId } }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["workspace", orgId] });
  if (q.isLoading) return <Loader2 className="h-5 w-5 animate-spin" />;
  if (q.isError || !q.data) return <Card className="p-4 text-[14px] text-muted-foreground">This workspace isn't available.</Card>;
  const o = q.data;
  const owner = o.role === "owner";
  const canManage = owner || o.role === "admin";
  return (
    <>
      {o.billing && <BillingCard orgId={orgId} billing={o.billing} owner={owner} />}
      <InviteCard orgId={orgId} kind="client" onDone={refresh} />
      <Card className="p-4">
        <h2 className="text-[16px] font-semibold">Clients</h2>
        {o.roster.length === 0 ? (
          <p className="mt-2 text-[14px] text-muted-foreground">No clients yet. Your first client is free.</p>
        ) : (
          <ul className="mt-2 divide-y">
            {o.roster.map((c) => (
              <ClientRow key={c.client_id} orgId={orgId} row={c} canManage={canManage} onDone={refresh} />
            ))}
          </ul>
        )}
      </Card>
      {o.invitations.length > 0 && (
        <Card className="p-4">
          <h2 className="text-[16px] font-semibold">Waiting to accept</h2>
          <ul className="mt-2 divide-y">
            {o.invitations.map((i) => (
              <PendingRow key={i.id} inv={i} onDone={refresh} />
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-muted-foreground">An invitation isn't a paid client until it's accepted.</p>
        </Card>
      )}
      {owner && <InviteCard orgId={orgId} kind="member" onDone={refresh} />}
    </>
  );
}

function BillingCard({ orgId, billing, owner }: { orgId: string; billing: NonNullable<Awaited<ReturnType<typeof getWorkspaceOverview>>["billing"]>; owner: boolean }) {
  const start = useServerFn(startWorkspaceBilling);
  const go = useMutation({
    mutationFn: () => start({ data: { orgId } }),
    onSuccess: (r) => (window.location.href = r.url),
    onError: (e: Error) => toast.error(e.message),
  });
  const aiLeft = Math.max(0, billing.aiCredits - billing.aiUsed);
  return (
    <Card className="p-4">
      <h2 className="text-[16px] font-semibold">Billing</h2>
      <p className="mt-1 text-[14px]">
        {billing.seats.active} {billing.seats.active === 1 ? "client" : "clients"} · {billing.seats.monthlyLine}
      </p>
      <p className={`mt-1 text-[13px] ${billing.canWrite ? "text-muted-foreground" : "text-warning"}`}>{billing.line}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">
        AI this month: {aiLeft} of {billing.aiCredits} credits left{billing.aiPurchasedLeft ? `, plus ${billing.aiPurchasedLeft} bought` : ""}.
      </p>
      {owner && billing.seats.paid > 0 && (billing.state === "needs_setup" || billing.state === "canceled") && (
        <Button className="mt-3" onClick={() => go.mutate()} disabled={go.isPending}>
          {go.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set up billing (test mode)"}
        </Button>
      )}
    </Card>
  );
}

function InviteCard({ orgId, kind, onDone }: { orgId: string; kind: "client" | "member"; onDone: () => void }) {
  const invite = useServerFn(inviteToWorkspace);
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => invite({ data: { orgId, kind, email, role: kind === "member" ? "coach" : undefined } }),
    onSuccess: (r) => {
      setLink(r.link);
      setEmail("");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card className="p-4">
      <h2 className="text-[16px] font-semibold">{kind === "client" ? "Invite a client" : "Add a coach to your team"}</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {kind === "client"
          ? "They accept with the email you type here, and see exactly what they're sharing with you before they do."
          : "They join as a coach and see only the clients you assign them."}
      </p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) m.mutate();
        }}
      >
        <Input type="email" inputMode="email" autoComplete="off" placeholder="Their email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" />
        <Button type="submit" disabled={m.isPending || !email.trim()}>
          {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Invite"}
        </Button>
      </form>
      {link && (
        <div className="mt-3 rounded-lg bg-muted p-3 text-[13px]">
          <p className="font-medium">Send them this link. It's shown once and works for 14 days.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate">{link}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigator.clipboard.writeText(link).then(() => toast.success("Link copied"))}
            >
              <Copy className="mr-1 h-4 w-4" /> Copy
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function ClientRow({ orgId, row, canManage, onDone }: { orgId: string; row: any; canManage: boolean; onDone: () => void }) {
  const set = useServerFn(setWorkspaceClientStatus);
  const m = useMutation({
    mutationFn: (status: "active" | "paused" | "ended") => set({ data: { orgId, clientId: row.client_id, status } }),
    onSuccess: onDone,
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <li className="flex min-h-[52px] items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px]">{row.full_name ?? row.email ?? "Client"}</p>
        <p className="text-[13px] text-muted-foreground">{STATUS_WORD[row.status as keyof typeof STATUS_WORD]}</p>
      </div>
      {canManage && row.status === "active" && (
        <Button size="sm" variant="ghost" disabled={m.isPending} onClick={() => m.mutate("paused")}>Pause</Button>
      )}
      {canManage && row.status === "paused" && (
        <Button size="sm" variant="ghost" disabled={m.isPending} onClick={() => m.mutate("active")}>Resume</Button>
      )}
    </li>
  );
}

function PendingRow({ inv, onDone }: { inv: { id: string; email: string; kind: string }; onDone: () => void }) {
  const revoke = useServerFn(revokeWorkspaceInvitation);
  const m = useMutation({ mutationFn: () => revoke({ data: { id: inv.id } }), onSuccess: onDone, onError: (e: Error) => toast.error(e.message) });
  return (
    <li className="flex min-h-[48px] items-center gap-3 py-2">
      <p className="min-w-0 flex-1 truncate text-[14px]">
        {inv.email} <span className="text-muted-foreground">· {inv.kind === "client" ? "client" : "teammate"}</span>
      </p>
      <Button size="sm" variant="ghost" disabled={m.isPending} onClick={() => m.mutate()}>Cancel</Button>
    </li>
  );
}
