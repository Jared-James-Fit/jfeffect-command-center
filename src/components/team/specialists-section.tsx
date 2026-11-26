/**
 * Team → Staff access: game day coaches and performance specialists. Invite
 * (name and email → role → athletes → what they'll see → send), change which
 * athletes and categories each one sees, suspend, reactivate, remove, reset
 * their two-step sign-in, and keep individual clips from them.
 * Everything here is checked again on the server (team-admin.functions.ts).
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Mail,
  MessageSquare,
  Plus,
  ShieldOff,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SectionLabel } from "@/components/ui/section-label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QueryState, ListSkeleton } from "@/components/loading";
import { cn } from "@/lib/utils";
import { inviteExpiryLabel } from "@/lib/staff-roles";
import { resetTeammateTwoStep } from "@/lib/mfa-recovery.functions";
import {
  CATEGORY_WORDS,
  PRESETS,
  PRESET_ORDER,
  VIEW_CATEGORIES,
  permissionSummary,
  type CategoryFlags,
  type SpecialistPreset,
} from "@/lib/team-access/presets";
import {
  listFootageVisibility,
  listSpecialists,
  removeSpecialist,
  revokeSpecialistInvite,
  saveSpecialistInvite,
  searchSpecialistAthletes,
  sendSpecialistInvite,
  setFootageHidden,
  setSpecialistAccess,
  setSpecialistStatus,
  type SpecialistInvite,
  type TeamSpecialist,
} from "@/lib/team-access/team-admin.functions";

const KEY = ["team-specialists"] as const;

type AccessDraft = Array<{ clientId: string; athleteName: string } & CategoryFlags>;

export function SpecialistsSection() {
  const load = useServerFn(listSpecialists);
  const qc = useQueryClient();
  const list = useQuery({ queryKey: KEY, queryFn: () => load() });
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const [editing, setEditing] = useState<SpecialistInvite | "new" | null>(null);
  const [access, setAccess] = useState<TeamSpecialist | null>(null);
  const [footage, setFootage] = useState<{ clientId: string; name: string } | null>(null);
  return (
    <section className="space-y-2">
      <div className="flex items-end justify-between gap-2">
        <SectionLabel>Game day coaches and specialists</SectionLabel>
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
          <UserPlus className="mr-1.5 h-4 w-4" /> Invite
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        View-only access to the athletes you pick: their footage, training and performance. Never
        programming, messages, nutrition, Crew or anything about the business.
      </p>
      <QueryState query={list} what="the specialists" skeleton={<ListSkeleton rows={2} />}>
        {(d) => (
          <div className="space-y-2">
            {d.invites.map((inv) => (
              <InviteCard
                key={inv.id}
                inv={inv}
                onEdit={() => setEditing(inv)}
                onChanged={refresh}
              />
            ))}
            {d.specialists.map((s) => (
              <SpecialistCard
                key={s.userId}
                s={s}
                onAccess={() => setAccess(s)}
                onFootage={(clientId, name) => setFootage({ clientId, name })}
                onChanged={refresh}
              />
            ))}
            {!d.invites.length && !d.specialists.length && (
              <p className="py-3 text-sm text-muted-foreground">Nobody yet.</p>
            )}
          </div>
        )}
      </QueryState>
      {editing && (
        <InviteSheet
          invite={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={refresh}
        />
      )}
      {access && <AccessSheet s={access} onClose={() => setAccess(null)} onDone={refresh} />}
      {footage && (
        <FootageSheet
          clientId={footage.clientId}
          name={footage.name}
          onClose={() => setFootage(null)}
        />
      )}
    </section>
  );
}

function summary(flags: CategoryFlags): string {
  const on = VIEW_CATEGORIES.filter((c) => flags[c]).map((c) =>
    CATEGORY_WORDS[c].label.toLowerCase(),
  );
  return on.length ? on.join(", ") : "nothing";
}

function InviteCard({
  inv,
  onEdit,
  onChanged,
}: {
  inv: SpecialistInvite;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const send = useServerFn(sendSpecialistInvite);
  const revoke = useServerFn(revokeSpecialistInvite);
  const [busy, setBusy] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [texting, setTexting] = useState(false);
  const name = [inv.firstName, inv.lastName].filter(Boolean).join(" ") || "Someone";
  async function run(kind: "email" | "sms" | "link" | "revoke") {
    setBusy(kind);
    try {
      if (kind === "revoke") {
        await revoke({ data: { inviteId: inv.id } });
        toast.success("Invite cancelled");
      } else {
        const r = await send({
          data: { inviteId: inv.id, method: kind, phone: kind === "sms" ? phone : undefined },
        });
        if (kind === "link" && r.link) {
          await navigator.clipboard.writeText(r.link).catch(() => undefined);
          toast.success(
            "Link copied. They'll confirm their email with a code before they set a password.",
          );
        } else if (r.sent) {
          toast.success(kind === "email" ? `Emailed to ${inv.email}` : "Texted");
        } else {
          toast.error(
            kind === "email"
              ? "Couldn't email it. Try Copy link."
              : "Couldn't text it. Try Copy link.",
          );
        }
        setTexting(false);
      }
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Something went wrong");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="rounded-2xl border border-border p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {name} <span className="font-normal text-muted-foreground">· {inv.title}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {inv.status === "draft"
              ? inv.email
                ? `Ready to send to ${inv.email}`
                : "Draft: add their email to send it"
              : `Sent${inv.email ? ` to ${inv.email}` : ""} · ${inviteExpiryLabel(inv.expiresAt)}`}
          </div>
          <div className="mt-1 text-xs">
            {inv.access.length ? (
              inv.access.map((a) => `${a.athleteName}: ${summary(a)}`).join(" · ")
            ) : (
              <span className="text-warning">No athlete picked yet</span>
            )}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={onEdit}>
          Edit
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {inv.email && (
          <Button
            size="sm"
            onClick={() => void run("email")}
            loading={busy === "email"}
            disabled={!!busy}
          >
            <Mail className="mr-1.5 h-4 w-4" />{" "}
            {inv.status === "draft" ? "Email the invite" : "Email it again"}
          </Button>
        )}
        {inv.email && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setTexting((v) => !v)}
            disabled={!!busy}
          >
            <MessageSquare className="mr-1.5 h-4 w-4" /> Text
          </Button>
        )}
        {inv.email && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void run("link")}
            loading={busy === "link"}
            disabled={!!busy}
          >
            <Copy className="mr-1.5 h-4 w-4" /> Copy link
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-muted-foreground"
          onClick={() => void run("revoke")}
          loading={busy === "revoke"}
          disabled={!!busy}
        >
          Cancel invite
        </Button>
      </div>
      {texting && (
        <div className="mt-2 flex gap-2">
          <Input
            type="tel"
            inputMode="tel"
            placeholder="Their phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Button
            size="sm"
            onClick={() => void run("sms")}
            disabled={phone.trim().length < 7 || !!busy}
            loading={busy === "sms"}
          >
            Send
          </Button>
        </div>
      )}
    </div>
  );
}

function SpecialistCard({
  s,
  onAccess,
  onFootage,
  onChanged,
}: {
  s: TeamSpecialist;
  onAccess: () => void;
  onFootage: (clientId: string, name: string) => void;
  onChanged: () => void;
}) {
  const setStatus = useServerFn(setSpecialistStatus);
  const remove = useServerFn(removeSpecialist);
  const reset = useServerFn(resetTeammateTwoStep);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  async function run(kind: "suspend" | "reactivate" | "remove" | "reset") {
    setBusy(kind);
    try {
      if (kind === "remove") await remove({ data: { userId: s.userId } });
      else if (kind === "reset") await reset({ data: { userId: s.userId } });
      else
        await setStatus({
          data: { userId: s.userId, status: kind === "suspend" ? "suspended" : "active" },
        });
      toast.success(
        kind === "remove"
          ? `${s.name} no longer has access`
          : kind === "reset"
            ? "Two-step sign-in reset"
            : kind === "suspend"
              ? `${s.name} is paused`
              : `${s.name} is active again`,
      );
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Something went wrong");
    } finally {
      setBusy(null);
      setConfirmRemove(false);
    }
  }
  const statusWord =
    s.status === "active"
      ? s.profileComplete
        ? "Active"
        : "Finishing their profile"
      : s.status === "suspended"
        ? "Paused"
        : "Removed";
  return (
    <div className="rounded-2xl border border-border p-3">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-sm font-semibold">
          {s.headshotUrl ? (
            <img src={s.headshotUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            s.name.slice(0, 1)
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {s.name} <span className="font-normal text-muted-foreground">· {s.title}</span>
          </div>
          <div
            className={cn(
              "text-xs",
              s.status === "active" ? "text-muted-foreground" : "text-warning",
            )}
          >
            {statusWord}
            {s.email ? ` · ${s.email}` : ""}
          </div>
        </div>
      </div>
      {s.status !== "removed" && (
        <ul className="mt-2 space-y-1 text-sm">
          {s.access
            .filter((a) => a.status === "active")
            .map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {a.athleteName} <span className="text-muted-foreground">· {summary(a)}</span>
                  {!a.agreed && (
                    <span className="block text-xs text-warning">
                      {a.athleteHasLogin
                        ? `Waiting for ${a.athleteName.split(" ")[0]} to agree in their app (Account → Team access)`
                        : "Needs an app login to agree"}
                    </span>
                  )}
                </span>
                {a.footage && (
                  <button
                    type="button"
                    className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
                    onClick={() => onFootage(a.clientId, a.athleteName)}
                  >
                    Clips
                  </button>
                )}
              </li>
            ))}
          {!s.access.some((a) => a.status === "active") && (
            <li className="text-xs text-muted-foreground">No athletes</li>
          )}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {s.status !== "removed" && (
          <Button size="sm" variant="outline" onClick={onAccess}>
            Athletes and access
          </Button>
        )}
        {s.status === "active" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void run("suspend")}
            loading={busy === "suspend"}
            disabled={!!busy}
          >
            Pause
          </Button>
        )}
        {s.status === "suspended" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void run("reactivate")}
            loading={busy === "reactivate"}
            disabled={!!busy}
          >
            Reactivate
          </Button>
        )}
        {s.status !== "removed" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void run("reset")}
            loading={busy === "reset"}
            disabled={!!busy}
          >
            <ShieldOff className="mr-1.5 h-4 w-4" /> Reset two-step
          </Button>
        )}
        {s.status !== "removed" &&
          (confirmRemove ? (
            <span className="ml-auto flex items-center gap-1">
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void run("remove")}
                loading={busy === "remove"}
                disabled={!!busy}
              >
                Remove now
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                Keep
              </Button>
            </span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-muted-foreground"
              onClick={() => setConfirmRemove(true)}
            >
              <Trash2 className="mr-1.5 h-4 w-4" /> Remove
            </Button>
          ))}
      </div>
    </div>
  );
}

function AthletePicker({
  value,
  onChange,
}: {
  value: AccessDraft;
  onChange: (v: AccessDraft) => void;
}) {
  const search = useServerFn(searchSpecialistAthletes);
  const [q, setQ] = useState("");
  const results = useQuery({
    queryKey: ["specialist-athlete-search", q],
    queryFn: () => search({ data: { q } }),
    staleTime: 30_000,
  });
  const picked = new Set(value.map((v) => v.clientId));
  return (
    <div className="space-y-3">
      {value.map((a) => (
        <div key={a.clientId} className="rounded-xl border border-border p-3">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{a.athleteName}</span>
            <button
              type="button"
              className="rounded p-1 hover:bg-muted"
              aria-label={`Remove ${a.athleteName}`}
              onClick={() => onChange(value.filter((v) => v.clientId !== a.clientId))}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 space-y-2">
            {VIEW_CATEGORIES.map((c) => (
              <label key={c} className="flex items-center gap-3 text-sm">
                <Switch
                  checked={a[c]}
                  onCheckedChange={(on) =>
                    onChange(value.map((v) => (v.clientId === a.clientId ? { ...v, [c]: on } : v)))
                  }
                />
                <span className="min-w-0">
                  <span className="font-medium">{CATEGORY_WORDS[c].label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {CATEGORY_WORDS[c].line}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="space-y-1.5">
        <Label htmlFor="sp-athlete-search">Add an athlete</Label>
        <Input
          id="sp-athlete-search"
          placeholder="Search by name or email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="space-y-1">
          {(results.data?.athletes ?? [])
            .filter((a) => !picked.has(a.id))
            .slice(0, 6)
            .map((a) => (
              <button
                key={a.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() =>
                  onChange([
                    ...value,
                    {
                      clientId: a.id,
                      athleteName: a.name,
                      footage: true,
                      training: true,
                      performance: true,
                    },
                  ])
                }
              >
                <Plus className="h-4 w-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                {a.yours && <span className="text-xs text-muted-foreground">You</span>}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

function Summary({ access }: { access: AccessDraft }) {
  const s = permissionSummary(access.map((a) => ({ name: a.athleteName, flags: a })));
  return (
    <div className="space-y-2 rounded-xl bg-muted/50 p-3 text-sm">
      <div className="font-semibold">What they'll see</div>
      {s.sees.length ? (
        <ul className="space-y-0.5">
          {s.sees.map((line) => (
            <li key={line} className="flex gap-1.5">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              {line}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">Nothing yet. Pick an athlete.</p>
      )}
      <div className="pt-1 font-semibold">Never</div>
      <ul className="space-y-0.5 text-muted-foreground">
        {s.never.map((line) => (
          <li key={line} className="flex gap-1.5">
            <X className="mt-0.5 h-4 w-4 shrink-0" />
            {line}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Any athlete but your own athlete account has to agree in their app before anything shows.
        Their notes stay private to them unless they share one with the athlete.
      </p>
    </div>
  );
}

function InviteSheet({
  invite,
  onClose,
  onDone,
}: {
  invite: SpecialistInvite | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const save = useServerFn(saveSpecialistInvite);
  const send = useServerFn(sendSpecialistInvite);
  const [first, setFirst] = useState(invite?.firstName ?? "");
  const [last, setLast] = useState(invite?.lastName ?? "");
  const [email, setEmail] = useState(invite?.email ?? "");
  const [preset, setPreset] = useState<SpecialistPreset>(invite?.preset ?? "game_day_coach");
  const [title, setTitle] = useState(invite?.title ?? PRESETS.game_day_coach.label);
  const [access, setAccess] = useState<AccessDraft>(invite?.access ?? []);
  const [busy, setBusy] = useState<"save" | "send" | null>(null);
  const emailOk = !email.trim() || /^\S+@\S+\.\S+$/.test(email.trim());
  async function submit(andSend: boolean) {
    setBusy(andSend ? "send" : "save");
    try {
      const r = await save({
        data: {
          id: invite?.id,
          firstName: first.trim(),
          lastName: last.trim(),
          email: email.trim().toLowerCase(),
          preset,
          title: title.trim(),
          access: access.map(({ clientId, footage, training, performance }) => ({
            client_id: clientId,
            footage,
            training,
            performance,
          })),
        },
      });
      if (andSend) {
        const s = await send({ data: { inviteId: r.id, method: "email" } });
        if (s.sent) toast.success(`Invite emailed to ${email.trim()}`);
        else toast.error("Saved, but the email didn't go. Use Copy link on the card.");
      } else {
        toast.success(email.trim() ? "Saved" : "Saved as a draft");
      }
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save");
    } finally {
      setBusy(null);
    }
  }
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{invite ? "Edit invite" : "Invite a specialist"}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-5">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="inv-first">First name</Label>
              <Input id="inv-first" value={first} onChange={(e) => setFirst(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-last">Last name</Label>
              <Input id="inv-last" value={last} onChange={(e) => setLast(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-email">Email</Label>
            <Input
              id="inv-email"
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Leave empty to keep it a draft"
            />
            <p className="text-xs text-muted-foreground">
              The email they'll sign in with. It must be new to JF Effect: team logins are separate
              from client accounts.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select
              value={preset}
              onValueChange={(v) => {
                const p = v as SpecialistPreset;
                if (title === PRESETS[preset].label) setTitle(PRESETS[p].label);
                setPreset(p);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESET_ORDER.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRESETS[p].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{PRESETS[preset].summary}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-title">What to call the role</Label>
            <Input
              id="inv-title"
              value={title}
              maxLength={60}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Athletes</Label>
            <AthletePicker value={access} onChange={setAccess} />
          </div>
          <Summary access={access} />
          <div className="flex flex-col gap-2 pb-6">
            <Button
              onClick={() => void submit(true)}
              disabled={
                !first.trim() ||
                !title.trim() ||
                !email.trim() ||
                !emailOk ||
                !access.length ||
                !!busy
              }
              loading={busy === "send"}
            >
              <Mail className="mr-1.5 h-4 w-4" /> Save and email the invite
            </Button>
            <Button
              variant="outline"
              onClick={() => void submit(false)}
              disabled={!first.trim() || !title.trim() || !emailOk || !!busy}
              loading={busy === "save"}
            >
              {email.trim() ? "Save, send later" : "Save as a draft"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AccessSheet({
  s,
  onClose,
  onDone,
}: {
  s: TeamSpecialist;
  onClose: () => void;
  onDone: () => void;
}) {
  const save = useServerFn(setSpecialistAccess);
  const [access, setAccess] = useState<AccessDraft>(() =>
    s.access
      .filter((a) => a.status === "active")
      .map((a) => ({
        clientId: a.clientId,
        athleteName: a.athleteName,
        footage: a.footage,
        training: a.training,
        performance: a.performance,
      })),
  );
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await save({
        data: {
          userId: s.userId,
          access: access.map(({ clientId, footage, training, performance }) => ({
            client_id: clientId,
            footage,
            training,
            performance,
          })),
        },
      });
      toast.success("Access updated");
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{s.name}'s athletes</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-5 pb-6">
          <AthletePicker value={access} onChange={setAccess} />
          <Summary access={access} />
          <Button className="w-full" onClick={() => void submit()} loading={busy} disabled={busy}>
            Save
          </Button>
          <p className="text-xs text-muted-foreground">
            An athlete you take off loses access at once. A category turned off stops showing at
            once.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FootageSheet({
  clientId,
  name,
  onClose,
}: {
  clientId: string;
  name: string;
  onClose: () => void;
}) {
  const load = useServerFn(listFootageVisibility);
  const setHidden = useServerFn(setFootageHidden);
  const qc = useQueryClient();
  const key = ["specialist-footage-visibility", clientId];
  const vids = useQuery({ queryKey: key, queryFn: () => load({ data: { clientId } }) });
  const [busy, setBusy] = useState<string | null>(null);
  const hiddenCount = useMemo(
    () => (vids.data?.videos ?? []).filter((v) => v.hidden).length,
    [vids.data],
  );
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{name}'s clips</SheetTitle>
        </SheetHeader>
        <p className="mt-2 text-sm text-muted-foreground">
          Specialists see every clip unless you keep one from them.
          {hiddenCount ? ` ${hiddenCount} kept from them.` : ""}
        </p>
        <QueryState
          query={vids}
          what="the clips"
          skeleton={<ListSkeleton rows={5} avatar={false} />}
          className="mt-3"
        >
          {(d) => (
            <ul className="divide-y divide-border">
              {d.videos.map((v) => (
                <li key={v.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {v.exercise}{" "}
                    <span className="text-muted-foreground">
                      · {v.set} · {v.day}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant={v.hidden ? "outline" : "ghost"}
                    loading={busy === v.id}
                    disabled={!!busy}
                    onClick={async () => {
                      setBusy(v.id);
                      try {
                        await setHidden({ data: { videoId: v.id, hidden: !v.hidden } });
                        await qc.invalidateQueries({ queryKey: key });
                      } catch (e: any) {
                        toast.error(e?.message ?? "Couldn't change it");
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    {v.hidden ? (
                      <EyeOff className="mr-1.5 h-4 w-4" />
                    ) : (
                      <Eye className="mr-1.5 h-4 w-4" />
                    )}
                    {v.hidden ? "Kept from them" : "Shown"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </SheetContent>
    </Sheet>
  );
}
