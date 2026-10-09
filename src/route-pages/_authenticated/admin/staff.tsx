import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  BookOpenCheck, Check, CheckCircle2, ChevronRight, Copy, Crown, Link2, Loader2, Lock, MessageCircle,
  RefreshCw, Search, Smartphone, UserPlus, Users, X, type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";
import {
  getStaffInviteLink, inviteStaff, listTeam, removeStaffRole, resendStaffInvite, revokeStaffInvite,
  searchInviteRecipients, type TeamInvite, type TeamMember,
} from "@/lib/staff-invites.functions";
import {
  INVITE_TTL_DAYS, STAFF_ROLE_INFO, STAFF_ROLE_ORDER, inviteExpiryLabel, staffInviteMessage, staffRoleLabel,
  type InvitableRole, type InviteDelivery, type StaffRoleKey,
} from "@/lib/staff-roles";

export function StaffRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/admin/team", search: { tab: "staff-media" } as any, replace: true });
  }, [navigate]);
  return null;
}

const TEAM_KEY = ["team-access"];

const ROLE_ICON: Record<StaffRoleKey, LucideIcon> = {
  finance: BookOpenCheck,
  coach: Users,
  admin: Crown,
  media_manager: Lock,
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function initials(name: string | null | undefined, email?: string | null) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function RoleBadge({ role, owner }: { role: string; owner?: boolean }) {
  const label = owner && role === "admin" ? "Owner" : staffRoleLabel(role);
  const tone =
    role === "admin" ? "bg-primary/15 text-primary"
    : role === "finance" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
    : role === "coach" ? "bg-sky-500/15 text-sky-600 dark:text-sky-400"
    : "bg-muted text-muted-foreground";
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", tone)}>{label}</span>;
}

function Avatar({ text }: { text: string }) {
  return (
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary text-sm font-bold text-foreground/80">{text}</div>
  );
}

function deliveryLine(inv: TeamInvite): string {
  const where =
    inv.delivery_method === "messenger" ? `Sent in Messenger${inv.delivery_client_name ? ` to ${inv.delivery_client_name}` : ""}`
    : inv.delivery_method === "sms" ? (inv.delivered_at ? "Sent by text" : "Text didn't send")
    : "Link copied";
  return `${where} · ${inviteExpiryLabel(inv.expires_at)}`;
}

export function StaffPage({ embedded = false }: { embedded?: boolean } = {}) {
  const list = useServerFn(listTeam);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: TEAM_KEY, queryFn: () => list() });
  const [adding, setAdding] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: TEAM_KEY });

  const members = useMemo(() => {
    const rank = (m: TeamMember) => (m.owner ? 0 : m.roles.includes("admin") ? 1 : m.roles.includes("finance") ? 2 : m.roles.includes("coach") ? 3 : 4);
    return [...(data?.members ?? [])].sort((a, b) => rank(a) - rank(b) || (a.name ?? "").localeCompare(b.name ?? ""));
  }, [data]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      {!embedded && (
        <header>
          <h1 className="text-2xl font-black tracking-tight md:text-3xl">Staff access</h1>
        </header>
      )}

      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-base font-bold">Give someone a team login</div>
          <p className="text-sm text-muted-foreground">
            Pick a role, add their details, and send the setup link. Team logins are always separate from client accounts.
          </p>
        </div>
        <Button className="shrink-0" onClick={() => setAdding(true)}>
          <UserPlus className="mr-1.5 h-4 w-4" /> Add person
        </Button>
      </Card>

      {(data?.invites ?? []).length > 0 && (
        <section>
          <SectionLabel>Waiting to set up · {data!.invites.length}</SectionLabel>
          <div className="space-y-2">
            {data!.invites.map((inv) => <PendingInviteCard key={inv.id} inv={inv} onChanged={refresh} />)}
          </div>
        </section>
      )}

      <section>
        <SectionLabel>Team</SectionLabel>
        {isLoading && <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        <div className="space-y-2">
          {members.map((m) => <MemberCard key={m.user_id} m={m} onChanged={refresh} />)}
        </div>
      </section>

      <section>
        <SectionLabel>What each role can do</SectionLabel>
        <RoleGuide />
      </section>

      <AddStaffDialog open={adding} onOpenChange={setAdding} onDone={refresh} />
    </div>
  );
}

function PendingInviteCard({ inv, onChanged }: { inv: TeamInvite; onChanged: () => void }) {
  const resend = useServerFn(resendStaffInvite);
  const revoke = useServerFn(revokeStaffInvite);
  const getLink = useServerFn(getStaffInviteLink);
  const [busy, setBusy] = useState<null | "copy" | "resend" | "revoke">(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const name = [inv.first_name, inv.last_name].filter(Boolean).join(" ") || inv.email;
  const expired = inviteExpiryLabel(inv.expires_at) === "Expired";

  async function run(kind: "copy" | "resend" | "revoke") {
    setBusy(kind);
    try {
      if (kind === "copy") {
        const { link } = await getLink({ data: { inviteId: inv.id } });
        if (await copyText(link)) toast.success("Setup link copied");
        else toast.message(link);
      } else if (kind === "resend") {
        const r: any = await resend({ data: { inviteId: inv.id } });
        if (r.delivery?.sent) toast.success(r.delivery.method === "messenger" ? "Sent again in Messenger" : "Sent again by text");
        else {
          const copied = await copyText(r.link);
          toast.success(copied ? "New link copied" : "New link ready");
        }
      } else {
        await revoke({ data: { inviteId: inv.id } });
        toast.success("Invite revoked");
      }
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-3">
      <div className="flex items-start gap-3">
        <Avatar text={initials(name, inv.email)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-semibold">{name}</span>
            <RoleBadge role={inv.role} />
          </div>
          <div className="truncate text-xs text-muted-foreground">{inv.email}</div>
          <div className={cn("mt-1 text-xs", expired ? "text-destructive" : "text-muted-foreground")}>{deliveryLine(inv)}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button size="sm" variant="outline" disabled={!!busy || expired} onClick={() => void run("copy")}>
          {busy === "copy" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="mr-1.5 h-4 w-4" />} Copy link
        </Button>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run("resend")}>
          {busy === "resend" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />} Resend
        </Button>
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={!!busy} onClick={() => setConfirmRevoke(true)}>
          <X className="mr-1.5 h-4 w-4" /> Revoke
        </Button>
      </div>
      <AlertDialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {name}'s invite?</AlertDialogTitle>
            <AlertDialogDescription>The setup link stops working. You can send a new invite any time.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run("revoke")}>Revoke</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function MemberCard({ m, onChanged }: { m: TeamMember; onChanged: () => void }) {
  const remove = useServerFn(removeStaffRole);
  const navigate = useNavigate();
  const removable = (["finance", "media_manager"] as const).find((r) => m.roles.includes(r));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const isCoachOnly = m.roles.includes("coach") && !m.roles.includes("admin");

  return (
    <Card className="flex items-center gap-3 p-3">
      <Avatar text={initials(m.name, m.email)} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-semibold">{m.name || m.email || "Team member"}</span>
          {m.roles.filter((r) => r !== "coach" || !m.roles.includes("admin")).map((r) => <RoleBadge key={r} role={r} owner={m.owner} />)}
        </div>
        <div className="truncate text-xs text-muted-foreground">{m.email}</div>
        {m.roles.includes("media_manager") && (
          <div className="mt-0.5 text-xs text-muted-foreground">Media Manager is retired, so this login has nowhere to go.</div>
        )}
      </div>
      {removable && (
        <Button size="sm" variant="outline" className="shrink-0" disabled={busy} onClick={() => setConfirm(true)}>Remove</Button>
      )}
      {!removable && isCoachOnly && (
        <Button size="sm" variant="ghost" className="shrink-0" onClick={() => navigate({ to: "/admin/team", search: { tab: "people" } as any })}>
          People <ChevronRight className="ml-0.5 h-4 w-4" />
        </Button>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {m.name || "this person"}'s {staffRoleLabel(removable)} access?</AlertDialogTitle>
            <AlertDialogDescription>They can still sign in, but they'll have no access to anything. You can invite them again later.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async () => {
              if (!removable) return;
              setBusy(true);
              try { await remove({ data: { userId: m.user_id, role: removable } }); toast.success("Access removed"); onChanged(); }
              catch (e: any) { toast.error(e?.message ?? "Couldn't remove access"); }
              finally { setBusy(false); }
            }}>Remove access</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function RoleGuide() {
  return (
    <Card className="px-4">
      <Accordion type="single" collapsible>
        {STAFF_ROLE_ORDER.map((key) => {
          const info = STAFF_ROLE_INFO[key];
          const Icon = ROLE_ICON[key];
          return (
            <AccordionItem key={key} value={key} className="last:border-b-0">
              <AccordionTrigger className="py-3 hover:no-underline">
                <span className="flex min-w-0 items-center gap-3 text-left">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{info.label}</span>
                    <span className="block text-xs font-normal text-muted-foreground">{info.summary}</span>
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent><RoleDetail role={key} /></AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </Card>
  );
}

function RoleDetail({ role }: { role: StaffRoleKey }) {
  const info = STAFF_ROLE_INFO[role];
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2">
      {info.can.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Can</div>
          <ul className="space-y-1">
            {info.can.map((c) => <li key={c} className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />{c}</li>)}
          </ul>
        </div>
      )}
      {info.cannot.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Can't</div>
          <ul className="space-y-1">
            {info.cannot.map((c) => <li key={c} className="flex gap-2"><X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />{c}</li>)}
          </ul>
        </div>
      )}
      {info.requiresAuthenticator && (
        <p className="text-xs text-muted-foreground sm:col-span-2">Signs in with a password plus an authenticator app code.</p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Add person */

type Step = "role" | "details" | "send" | "done";

function AddStaffDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const navigate = useNavigate();
  const invite = useServerFn(inviteStaff);
  const [step, setStep] = useState<Step>("role");
  const [role, setRole] = useState<InvitableRole>("finance");
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "" });
  const [method, setMethod] = useState<InviteDelivery>("messenger");
  const [recipient, setRecipient] = useState<{ id: string; name: string; email: string } | null>(null);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ link: string; sent: boolean; method: InviteDelivery; copied: boolean } | null>(null);

  useEffect(() => {
    if (open) return;
    // Reset after the close animation.
    const t = setTimeout(() => {
      setStep("role"); setRole("finance"); setForm({ first_name: "", last_name: "", email: "" });
      setMethod("messenger"); setRecipient(null); setPhone(""); setResult(null);
    }, 200);
    return () => clearTimeout(t);
  }, [open]);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const detailsOk = form.first_name.trim().length > 0 && emailOk;
  const sendOk = method === "link" || (method === "messenger" && !!recipient) || (method === "sms" && phone.replace(/\D/g, "").length >= 10);

  async function submit() {
    setBusy(true);
    try {
      const delivery =
        method === "messenger" ? { method, clientId: recipient!.id }
        : method === "sms" ? { method, phone }
        : { method: "link" as const };
      const r: any = await invite({ data: { role, ...form, delivery } as any });
      const copied = method === "link" || !r.delivery?.sent ? await copyText(r.link) : false;
      setResult({ link: r.link, sent: !!r.delivery?.sent, method, copied });
      setStep("done");
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send the invite");
    } finally {
      setBusy(false);
    }
  }

  const stepIndex = { role: 0, details: 1, send: 2, done: 3 }[step];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {step === "role" ? "What will they do?" : step === "details" ? "Who are they?" : step === "send" ? "Send the setup link" : "Invite sent"}
          </DialogTitle>
          <DialogDescription className="sr-only">Add a team member in three steps.</DialogDescription>
          {step !== "done" && (
            <div className="flex gap-1.5 pt-1" aria-hidden>
              {[0, 1, 2].map((i) => <div key={i} className={cn("h-1 flex-1 rounded-full", i <= stepIndex ? "bg-primary" : "bg-muted")} />)}
            </div>
          )}
        </DialogHeader>

        {step === "role" && (
          <div className="space-y-2">
            {STAFF_ROLE_ORDER.map((key) => {
              const info = STAFF_ROLE_INFO[key];
              const Icon = ROLE_ICON[key];
              const selectable = info.setup === "invite";
              const selected = selectable && role === key;
              return (
                <div key={key}
                  role={selectable ? "radio" : undefined}
                  aria-checked={selectable ? selected : undefined}
                  tabIndex={selectable ? 0 : -1}
                  onClick={() => selectable && setRole(key as InvitableRole)}
                  onKeyDown={(e) => { if (selectable && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setRole(key as InvitableRole); } }}
                  className={cn(
                    "rounded-xl border p-3 transition-colors",
                    selectable ? "cursor-pointer hover:border-primary/60" : "opacity-80",
                    selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border",
                  )}>
                  <div className="flex items-start gap-3">
                    <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", selected ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground/70")}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{info.label}</span>
                        {selected && <CheckCircle2 className="h-5 w-5 text-primary" />}
                        {info.setup === "owner_only" && <span className="text-[11px] text-muted-foreground">Only you</span>}
                        {info.setup === "retired" && <span className="text-[11px] text-muted-foreground">Not available</span>}
                      </div>
                      <p className="text-sm text-muted-foreground">{info.summary}</p>
                      {selected && <div className="mt-3"><RoleDetail role={key} /></div>}
                      {info.setup === "people" && (
                        <Button size="sm" variant="outline" className="mt-2" onClick={(e) => {
                          e.stopPropagation();
                          onOpenChange(false);
                          navigate({ to: "/admin/team", search: { tab: "people" } as any });
                        }}>
                          Add a coach in People <ChevronRight className="ml-0.5 h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <Button className="mt-2 w-full" onClick={() => setStep("details")}>
              Continue as {STAFF_ROLE_INFO[role].label}
            </Button>
          </div>
        )}

        {step === "details" && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="staff-first">First name</Label>
                <Input id="staff-first" autoComplete="off" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="staff-last">Last name <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id="staff-last" autoComplete="off" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-email">Team login email</Label>
              <Input id="staff-email" type="email" inputMode="email" autoCapitalize="none" autoComplete="off"
                value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <p className="text-xs text-muted-foreground">
                A new email they don't use for anything else in JF Effect. Not their client login: team and client accounts never share an email.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("role")}>Back</Button>
              <Button className="flex-1" disabled={!detailsOk} onClick={() => setStep("send")}>Continue</Button>
            </div>
          </div>
        )}

        {step === "send" && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="How to send it">
              {([
                ["messenger", MessageCircle, "Messenger"],
                ["sms", Smartphone, "Text"],
                ["link", Link2, "Copy link"],
              ] as const).map(([key, Icon, label]) => (
                <button key={key} type="button" role="radio" aria-checked={method === key} onClick={() => setMethod(key)}
                  className={cn("flex flex-col items-center gap-1 rounded-xl border p-3 text-sm font-medium transition-colors",
                    method === key ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/60")}>
                  <Icon className="h-5 w-5" /> {label}
                </button>
              ))}
            </div>

            {method === "messenger" && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">If they're also a client, the setup card lands in their client chat, from you.</p>
                <RecipientPicker value={recipient} onChange={setRecipient} defaultQuery={form.first_name} />
                {recipient && (
                  <div className="rounded-xl border bg-secondary/40 p-3">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">They'll get</div>
                    <p className="whitespace-pre-line text-sm">{staffInviteMessage({ firstName: form.first_name, role, email: form.email.trim().toLowerCase() })}</p>
                    <div className="mt-2 rounded-lg bg-primary px-3 py-2 text-center text-sm font-semibold text-primary-foreground">Set up your team account</div>
                  </div>
                )}
              </div>
            )}
            {method === "sms" && (
              <div className="space-y-1.5">
                <Label htmlFor="staff-phone">Mobile number</Label>
                <Input id="staff-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="204 555 0123" />
              </div>
            )}
            {method === "link" && (
              <p className="text-sm text-muted-foreground">You'll get the link to send however you like. It works for {INVITE_TTL_DAYS} days, once.</p>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("details")}>Back</Button>
              <Button className="flex-1" disabled={!sendOk || busy} onClick={() => void submit()}>
                {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {method === "link" ? "Create link" : "Send invite"}
              </Button>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
              <div className="text-sm">
                <div className="font-semibold">
                  {result.sent && result.method === "messenger" ? `Sent to ${recipient?.name ?? form.first_name} in Messenger`
                    : result.sent && result.method === "sms" ? "Sent by text"
                    : result.copied ? "Link copied" : "Link ready"}
                </div>
                {!result.sent && result.method !== "link" && <div className="text-muted-foreground">It didn't send, so the link was copied for you to send.</div>}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">What happens next</div>
              <ol className="space-y-2 text-sm">
                <li className="flex gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-bold">1</span>They tap the link and create a password for {form.email.trim().toLowerCase()}.</li>
                {STAFF_ROLE_INFO[role].requiresAuthenticator && (
                  <li className="flex gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-bold">2</span>They connect an authenticator app (one tap on their phone).</li>
                )}
                <li className="flex gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-bold">{STAFF_ROLE_INFO[role].requiresAuthenticator ? 3 : 2}</span>They land straight in {role === "finance" ? "the books" : "their area"}. You'll see them under Team.</li>
              </ol>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={async () => {
                if (await copyText(result.link)) toast.success("Link copied");
                else toast.message(result.link);
              }}>
                <Copy className="mr-1.5 h-4 w-4" /> Copy link
              </Button>
              <Button className="flex-1" onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RecipientPicker({
  value, onChange, defaultQuery,
}: {
  value: { id: string; name: string; email: string } | null;
  onChange: (v: { id: string; name: string; email: string } | null) => void;
  defaultQuery: string;
}) {
  const search = useServerFn(searchInviteRecipients);
  const [q, setQ] = useState(defaultQuery);
  const [debounced, setDebounced] = useState(defaultQuery);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const { data, isFetching } = useQuery({
    queryKey: ["staff-invite-recipients", debounced],
    queryFn: () => search({ data: { q: debounced } }),
    enabled: !value && debounced.length >= 2,
    staleTime: 30_000,
  });

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border p-3">
        <Avatar text={initials(value.name, value.email)} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{value.name}</div>
          <div className="truncate text-xs text-muted-foreground">Client account · {value.email}</div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Change</Button>
      </div>
    );
  }

  const rows = data?.clients ?? [];
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Find their client account" value={q} onChange={(e) => setQ(e.target.value)} />
        {isFetching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>
      {debounced.length >= 2 && !isFetching && rows.length === 0 && (
        <p className="text-xs text-muted-foreground">No client with an app login matches. Use Text or Copy link instead.</p>
      )}
      <div className="space-y-1">
        {rows.map((c) => (
          <button key={c.id} type="button" onClick={() => onChange(c)}
            className="flex w-full items-center gap-3 rounded-lg border border-transparent p-2 text-left hover:border-border hover:bg-secondary/50">
            <Avatar text={initials(c.name, c.email)} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{c.name}</div>
              <div className="truncate text-xs text-muted-foreground">{c.email}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
