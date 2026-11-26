import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, ArrowDown, ArrowUp, Heart, History, Hourglass, Loader2, Pencil, Plus, Power, RefreshCw, Trash2, UserPlus, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/user-avatar";
import { MembershipEmblem } from "@/components/membership-emblem";
import { VirtualTag } from "@/components/name-marks";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { STARTER_PERSONAS } from "@/lib/virtual-accounts/personas";
import { foldName } from "@/lib/virtual-accounts/names";
import { NameFields, errorWords, useNameDraft } from "@/components/admin/virtual-accounts/name-editor";
import { fullName, likeStateWords, rolloutStatusWords } from "@/lib/virtual-accounts/rollout";
import {
  addVirtualAccountFn,
  clearVirtualLikesFn,
  createStarterVirtualAccountsFn,
  renameVirtualAccountFn,
  listVirtualAccountsFn,
  setVirtualRolloutFn,
  setVirtualSettingsFn,
  updateVirtualAccountFn,
  virtualActivityFn,
  type RolloutState,
  type VirtualAccount,
  type VirtualSettings,
} from "@/lib/virtual-accounts/virtual-accounts.functions";

const KEY = ["admin-virtual-accounts"];
const SPORTS = ["powerlifting", "bodybuilding", "strength", "glutes", "fitness"] as const;
const hour = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;

/**
 * Virtual Crew accounts: fictional, disclosed ("Virtual" beside their name everywhere), free,
 * words only (no photos or media, never uploaded or generated), never posting, commenting,
 * following or messaging. The one automation is a like, off until switched on here, never a
 * notification, kept out of every count, ranking and statistic. The global switch stops it all.
 */
export function VirtualAccountsPage() {
  const { role, viewOnly } = useAuth();
  const canEdit = role === "admin" && !viewOnly;
  const qc = useQueryClient();
  const listFn = useServerFn(listVirtualAccountsFn);
  const createFn = useServerFn(createStarterVirtualAccountsFn);
  const settingsFn = useServerFn(setVirtualSettingsFn);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: KEY, queryFn: () => listFn(), staleTime: 15_000 });
  const [adding, setAdding] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });

  const create = useMutation({
    mutationFn: () => createFn(),
    onSuccess: (r) => {
      toast.success(r.made ? `Added ${r.made} virtual account${r.made === 1 ? "" : "s"}` : "They're all here already");
      if (r.skipped.length) toast.error(`Skipped: ${r.skipped.join("; ")}`);
      void refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't add them"),
  });
  const setSettings = useMutation({
    mutationFn: (patch: Partial<VirtualSettings>) => settingsFn({ data: patch }),
    onSuccess: (s, patch) => {
      qc.setQueryData(KEY, (prev: any) => (prev ? { ...prev, settings: s } : prev));
      void refresh();
      if ("automation_enabled" in patch) toast.success(s.automation_enabled ? "Automated likes are on" : "Automated likes are off");
      else if ("rollout_enabled" in patch) toast.success(s.rollout_enabled ? "Gradual start is on" : "Gradual start is off");
      else toast.success("Saved");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save"),
  });

  if (isLoading) {
    return (
      <div className="grid h-40 place-items-center" aria-busy="true">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="p-4">
        <Card className="p-6 text-center">
          <div className="mb-2 text-sm font-semibold text-destructive">Couldn't load the virtual accounts</div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </Card>
      </div>
    );
  }
  const s = data.settings;
  const missing = STARTER_PERSONAS.filter((p) => !data.accounts.some((a) => a.slug === p.slug)).length;

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 sm:p-4 md:p-6" data-virtual-accounts>
      <Card className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full", s.automation_enabled ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>
            <Power className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold">Automated likes</div>
            <p className="text-sm text-muted-foreground">
              The global switch. Off stops every virtual account at once. Each account also has its own switch below.
            </p>
          </div>
          <Switch
            checked={s.automation_enabled}
            disabled={!canEdit || setSettings.isPending}
            onCheckedChange={(v) => setSettings.mutate({ automation_enabled: v })}
            aria-label="Automated likes"
            data-virtual-kill-switch
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <NumberSetting label="Virtual likes a post, at most" value={s.per_post_max} min={1} max={5} disabled={!canEdit} onSave={(v) => setSettings.mutate({ per_post_max: v })} />
          <NumberSetting label="Posts up to (hours old)" value={s.max_post_age_hours} min={6} max={96} disabled={!canEdit} onSave={(v) => setSettings.mutate({ max_post_age_hours: v })} />
          <NumberSetting label="Not before (minutes old)" value={s.min_post_age_minutes} min={5} max={240} disabled={!canEdit} onSave={(v) => setSettings.mutate({ min_post_age_minutes: v })} />
        </div>
        <label className="flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3">
          <span className="text-sm">Also like coach and automated posts</span>
          <Switch checked={s.include_coach_posts} disabled={!canEdit} onCheckedChange={(v) => setSettings.mutate({ include_coach_posts: v })} />
        </label>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>Every virtual account shows "Virtual" beside its name, on its profile and in every list of likes.</li>
          <li>Only likes are automated: never posts, stories, comments, follows or messages. A like never sends a notification.</li>
          <li>Only crew-wide posts by real people; never a private account's, a story, or one whose author blocked it. Quiet hours and a daily limit apply.</li>
          <li>They're left out of member counts, revenue, conversion and engagement analytics, post scores and the rankings.</li>
          <li>No photos or media: their picture is their initials. Anything on their profile is yours to write here.</li>
          <li>
            Names are natural and varied, from one generator: never a placeholder like "Jon Doe" or "Test User", never another
            virtual account's first name or surname, and never a real member's name or the first name a member goes by. A
            placeholder name is replaced automatically, keeping the account, its likes and its history.
          </li>
        </ul>
      </Card>

      <RolloutCard accounts={data.accounts} settings={s} rollout={data.rollout} canEdit={canEdit} onSettings={(p) => setSettings.mutate(p)} onChanged={refresh} />

      {canEdit && (
        <div className="grid gap-2 sm:grid-cols-2">
          {missing > 0 && (
            <Button className="h-11" disabled={create.isPending} onClick={() => create.mutate()} data-virtual-create>
              {create.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UserPlus className="mr-1.5 h-4 w-4" />}
              Add {missing} starter virtual account{missing === 1 ? "" : "s"}
            </Button>
          )}
          <Button variant="outline" className={cn("h-11", missing === 0 && "sm:col-span-2")} onClick={() => setAdding(true)} data-virtual-add>
            <Plus className="mr-1.5 h-4 w-4" /> Add a virtual account
          </Button>
        </div>
      )}
      {adding && <AddDialog onClose={() => setAdding(false)} onAdded={refresh} />}

      {data.accounts.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">No virtual accounts yet.</Card>
      ) : (
        <ul className="space-y-2">
          {data.accounts.map((a) => (
            <VirtualRow key={a.user_id} a={a} canEdit={canEdit} onChanged={refresh} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NumberSetting({ label, value, min, max, disabled, onSave }: { label: string; value: number; min: number; max: number; disabled?: boolean; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  return (
    <label className="space-y-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <Input
        inputMode="numeric"
        value={v}
        disabled={disabled}
        onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={() => {
          const n = Math.min(max, Math.max(min, Number(v) || min));
          setV(String(n));
          if (n !== value) onSave(n);
        }}
        className="h-10"
      />
    </label>
  );
}

function VirtualRow({ a, canEdit, onChanged }: { a: VirtualAccount; canEdit: boolean; onChanged: () => void }) {
  const updateFn = useServerFn(updateVirtualAccountFn);
  const clearFn = useServerFn(clearVirtualLikesFn);
  const [edit, setEdit] = useState<false | "edit" | "rename">(false);
  const [log, setLog] = useState(false);
  const update = useMutation({
    mutationFn: (patch: Record<string, unknown>) => updateFn({ data: { userId: a.user_id, patch } as any }),
    onSuccess: () => onChanged(),
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save"),
  });
  const clear = useMutation({
    mutationFn: () => clearFn({ data: { userId: a.user_id } }),
    onSuccess: (r) => {
      toast.success(`Removed ${r.removed} like${r.removed === 1 ? "" : "s"}`);
      onChanged();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't remove them"),
  });
  const name = `${a.first_name}${a.last_name ? ` ${a.last_name}` : ""}`;
  return (
    <li className="space-y-3 rounded-2xl border bg-card p-4" data-virtual-row={a.slug}>
      <div className="flex items-start gap-3">
        <UserAvatar src={null} name={name} size={40} expandable={false} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold">{name}</span>
            <MembershipEmblem badge="free" size={14} />
            <VirtualTag />
          </div>
          <div className="truncate text-xs text-muted-foreground">
            @{a.username ?? a.slug}
            {nameSourceWords(a) && <span data-virtual-name-source> · {nameSourceWords(a)}</span>}
          </div>
          {a.name_problem && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-warning/10 px-2.5 py-1.5 text-xs" data-virtual-name-problem>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
              <span className="min-w-0 flex-1">{a.name_problem}</span>
              {canEdit && (
                <button type="button" className="inline-flex min-h-8 items-center gap-1 font-semibold underline-offset-2 hover:underline" onClick={() => setEdit("rename")}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Pick a new name
                </button>
              )}
            </div>
          )}
          {a.bio && <p className="mt-1 text-sm">{a.bio}</p>}
          <div className="mt-1 text-xs text-muted-foreground" data-virtual-like-state>
            {likeStateWords(a)} · {a.likes_24h} like{a.likes_24h === 1 ? "" : "s"} today · {a.likes_total} in all · {a.followers} follower{a.followers === 1 ? "" : "s"}
          </div>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 text-sm">
          Active
          <Switch checked={a.active} disabled={!canEdit} onCheckedChange={(v) => update.mutate({ active: v })} />
        </label>
        <label className="flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 text-sm">
          <span className="flex items-center gap-1.5">
            <Heart className="h-4 w-4" aria-hidden /> Likes posts
          </span>
          <Switch checked={a.likes_enabled} disabled={!canEdit} onCheckedChange={(v) => update.mutate({ likes_enabled: v })} />
        </label>
        <label className="flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 text-sm">
          Likes a day, at most
          <select
            className="h-9 rounded-md border bg-background px-2"
            value={a.daily_like_limit}
            disabled={!canEdit}
            onChange={(e) => update.mutate({ daily_like_limit: Number(e.target.value) })}
          >
            {[0, 1, 2, 3, 4, 6, 8, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 text-sm">
          Quiet
          <span className="flex items-center gap-1">
            <select className="h-9 rounded-md border bg-background px-1" value={a.quiet_start} disabled={!canEdit} onChange={(e) => update.mutate({ quiet_start: Number(e.target.value) })} aria-label="Quiet from">
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hour(h)}
                </option>
              ))}
            </select>
            –
            <select className="h-9 rounded-md border bg-background px-1" value={a.quiet_end} disabled={!canEdit} onChange={(e) => update.mutate({ quiet_end: Number(e.target.value) })} aria-label="Quiet until">
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hour(h)}
                </option>
              ))}
            </select>
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <Button variant="outline" size="sm" className="h-10" onClick={() => setEdit("edit")}>
            <Pencil className="mr-1.5 h-4 w-4" /> Edit profile
          </Button>
        )}
        <Button variant="outline" size="sm" className="h-10" onClick={() => setLog((v) => !v)} aria-expanded={log}>
          <History className="mr-1.5 h-4 w-4" /> Activity
        </Button>
        {canEdit && a.likes_total > 0 && (
          <Button variant="ghost" size="sm" className="h-10 text-destructive" disabled={clear.isPending} onClick={() => clear.mutate()}>
            <Trash2 className="mr-1.5 h-4 w-4" /> Remove its likes
          </Button>
        )}
      </div>
      {log && <ActivityLog userId={a.user_id} />}
      {edit && (
        <EditDialog
          a={a}
          suggestNew={edit === "rename"}
          onClose={() => setEdit(false)}
          onSaved={() => {
            setEdit(false);
            onChanged();
          }}
        />
      )}
    </li>
  );
}

function ActivityLog({ userId }: { userId: string }) {
  const fn = useServerFn(virtualActivityFn);
  const { data, isLoading } = useQuery({ queryKey: ["virtual-activity", userId], queryFn: () => fn({ data: { userId, limit: 30 } }) });
  if (isLoading) return <div className="text-xs text-muted-foreground">Loading…</div>;
  if (!data?.length) return <div className="text-xs text-muted-foreground">Nothing yet.</div>;
  return (
    <ul className="max-h-60 space-y-1 overflow-y-auto rounded-lg bg-muted/40 p-2 text-xs" data-virtual-activity>
      {data.map((e) => (
        <li key={e.id} className="flex justify-between gap-2">
          <span>
            {e.action === "like" ? "Liked a post" : e.action.replace(/_/g, " ")}
            {e.actor_user_id ? " (by an admin)" : e.action === "like" ? " (automated)" : ""}
          </span>
          <span className="shrink-0 text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The gradual start: queued accounts start liking one at a time, the next only after the gap
 * (days), a like since the last start, and in the daytime, so new names show up the way new
 * members do. The queue can be reordered, emptied or filled here; switching an account's likes on
 * by hand starts it now.
 */
function RolloutCard({
  accounts,
  settings: s,
  rollout,
  canEdit,
  onSettings,
  onChanged,
}: {
  accounts: VirtualAccount[];
  settings: VirtualSettings;
  rollout: RolloutState | null;
  canEdit: boolean;
  onSettings: (patch: Partial<VirtualSettings>) => void;
  onChanged: () => void;
}) {
  const fn = useServerFn(setVirtualRolloutFn);
  const queue = accounts
    .filter((a) => a.active && !a.likes_enabled && a.rollout_position != null)
    .sort((x, y) => (x.rollout_position ?? 0) - (y.rollout_position ?? 0));
  const waiting = accounts.filter((a) => a.active && !a.likes_enabled && a.rollout_position == null);
  const liking = accounts.filter((a) => a.active && a.likes_enabled).length;
  const save = useMutation({
    mutationFn: (order: string[]) => fn({ data: { order } }),
    onSuccess: () => onChanged(),
    onError: (e: unknown) => toast.error(errorWords(e, "Couldn't save the queue")),
  });
  const ids = queue.map((a) => a.user_id);
  const move = (i: number, d: -1 | 1) => {
    const next = [...ids];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    save.mutate(next);
  };
  return (
    <Card className="space-y-3 p-4" data-virtual-rollout>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <Hourglass className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold">Gradual start</div>
          <p className="text-sm text-muted-foreground">
            {liking} liking · {queue.length} in the queue. The next one starts once {s.rollout_gap_days} day{s.rollout_gap_days === 1 ? "" : "s"} have
            passed since the last, there's been a like since then, and it's daytime.
          </p>
        </div>
        <Switch
          checked={s.rollout_enabled}
          disabled={!canEdit}
          onCheckedChange={(v) => onSettings({ rollout_enabled: v })}
          aria-label="Gradual start"
          data-virtual-rollout-switch
        />
      </div>
      <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm" data-virtual-rollout-status>
        {rolloutStatusWords(rollout, accounts, s)}
      </p>
      <label className="flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 text-sm">
        Days between starts, at least
        <select
          className="h-9 rounded-md border bg-background px-2"
          value={s.rollout_gap_days}
          disabled={!canEdit}
          onChange={(e) => onSettings({ rollout_gap_days: Number(e.target.value) })}
          aria-label="Days between starts"
        >
          {[1, 2, 3, 4, 5, 7, 10, 14].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      {queue.length > 0 && (
        <ol className="space-y-1" data-virtual-rollout-queue>
          {queue.map((a, i) => (
            <li key={a.user_id} className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm">
              <span className="w-6 shrink-0 text-xs text-muted-foreground">#{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{fullName(a)}</span>
              {canEdit && (
                <span className="flex shrink-0 items-center">
                  <Button variant="ghost" size="icon" className="h-9 w-9" disabled={i === 0 || save.isPending} onClick={() => move(i, -1)} aria-label={`Move ${fullName(a)} up`}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-9 w-9" disabled={i === queue.length - 1 || save.isPending} onClick={() => move(i, 1)} aria-label={`Move ${fullName(a)} down`}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-9 w-9" disabled={save.isPending} onClick={() => save.mutate(ids.filter((x) => x !== a.user_id))} aria-label={`Take ${fullName(a)} out of the queue`}>
                    <X className="h-4 w-4" />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {canEdit && waiting.length > 0 && (
        <Button variant="outline" className="h-11 w-full" disabled={save.isPending} onClick={() => save.mutate([...ids, ...waiting.map((a) => a.user_id)])} data-virtual-rollout-queue-rest>
          Add {waiting.length} not liking yet to the queue
        </Button>
      )}
    </Card>
  );
}

/** How the account got the name it has, in a few words. */
function nameSourceWords(a: VirtualAccount): string | null {
  const when = a.name_set_at ? new Date(a.name_set_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;
  switch (a.name_source) {
    case "starter":
      return "Starter name";
    case "generated":
      return when ? `Generated name, ${when}` : "Generated name";
    case "admin":
      return when ? `Named by an admin, ${when}` : "Named by an admin";
    case "corrected":
      return when ? `Placeholder name replaced automatically, ${when}` : "Placeholder name replaced automatically";
    default:
      return null;
  }
}

/** Whether the username was made from the old first name, so a new name should bring a new username. */
function usernameFollowsName(username: string | null, first: string): boolean {
  const f = foldName(first).replace(/ /g, "");
  return !!username && f.length >= 3 && username.includes(f);
}

function EditDialog({ a, suggestNew, onClose, onSaved }: { a: VirtualAccount; suggestNew?: boolean; onClose: () => void; onSaved: () => void }) {
  const updateFn = useServerFn(updateVirtualAccountFn);
  const renameFn = useServerFn(renameVirtualAccountFn);
  const name = useNameDraft({ userId: a.user_id, first: a.first_name, last: a.last_name ?? "", gender: a.name_gender, suggestOnOpen: suggestNew });
  const [bio, setBio] = useState(a.bio ?? "");
  const [background, setBackground] = useState(a.background ?? "");
  const [notes, setNotes] = useState(a.notes ?? "");
  const [sports, setSports] = useState<string[]>(a.disciplines ?? []);
  const [moveUsername, setMoveUsername] = useState(usernameFollowsName(a.username, a.first_name));
  const [busy, setBusy] = useState(false);
  const d = name.draft;
  const nameOk = !name.changed || name.ready;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {a.first_name}</DialogTitle>
          <DialogDescription>Words only. A virtual account never gets a photo or media.</DialogDescription>
        </DialogHeader>
        {a.name_problem && !name.changed && (
          <p className="flex items-start gap-1.5 rounded-lg bg-warning/10 px-2.5 py-2 text-xs">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
            {a.name_problem}
          </p>
        )}
        <NameFields state={name} onError={(m) => toast.error(m)} />
        {name.changed && d.username && d.username !== a.username && (
          <label className="flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 text-sm" data-virtual-move-username>
            <span className="min-w-0">
              Change the username to <span className="font-semibold">@{d.username}</span>
              <span className="block text-xs text-muted-foreground">Now @{a.username ?? a.slug}</span>
            </span>
            <Switch checked={moveUsername} onCheckedChange={setMoveUsername} aria-label="Change the username too" />
          </label>
        )}
        <Textarea value={bio} onChange={(e) => setBio(e.target.value.slice(0, 150))} placeholder="Bio (150 characters, shown on their profile)" aria-label="Bio" rows={2} />
        <Textarea value={background} onChange={(e) => setBackground(e.target.value.slice(0, 600))} placeholder="Fitness background (admins only)" aria-label="Fitness background" rows={2} />
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 600))} placeholder="Notes (admins only)" aria-label="Notes" rows={2} />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sports">
          {SPORTS.map((sp) => {
            const on = sports.includes(sp);
            return (
              <button
                key={sp}
                type="button"
                aria-pressed={on}
                onClick={() => setSports((cur) => (on ? cur.filter((x) => x !== sp) : cur.length < 3 ? [...cur, sp] : cur))}
                className={cn("min-h-9 rounded-full border px-3 text-xs capitalize", on ? "border-foreground bg-foreground text-background" : "text-muted-foreground")}
              >
                {sp}
              </button>
            );
          })}
        </div>
        <Button
          className="h-11"
          loading={busy}
          disabled={busy || !nameOk}
          onClick={async () => {
            setBusy(true);
            try {
              if (name.changed) {
                await renameFn({
                  data: {
                    userId: a.user_id,
                    first: d.first.trim(),
                    last: d.last.trim(),
                    username: moveUsername && d.username && d.username !== a.username ? d.username : null,
                    gender: d.gender,
                    origin: d.origin,
                    source: d.source,
                  },
                });
              }
              await updateFn({ data: { userId: a.user_id, patch: { bio: bio.trim(), background: background.trim(), notes: notes.trim(), disciplines: sports as Array<(typeof SPORTS)[number]> } } });
              toast.success(name.changed ? `Renamed to ${d.first.trim()} ${d.last.trim()}` : "Saved");
              onSaved();
            } catch (e: unknown) {
              toast.error(errorWords(e, "Couldn't save"));
            } finally {
              setBusy(false);
            }
          }}
        >
          Save
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/** A new virtual account: a generated name to start (another one tap away), or one typed and checked. */
function AddDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const addFn = useServerFn(addVirtualAccountFn);
  const name = useNameDraft({ suggestOnOpen: true });
  const [busy, setBusy] = useState(false);
  const d = name.draft;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-virtual-add-dialog>
        <DialogHeader>
          <DialogTitle>Add a virtual account</DialogTitle>
          <DialogDescription>
            A free account labelled "Virtual" wherever it shows. Words only: no photo or media, and likes stay off until you turn them on.
          </DialogDescription>
        </DialogHeader>
        <NameFields state={name} onError={(m) => toast.error(m)} />
        <Button
          className="h-11"
          loading={busy || name.suggesting}
          disabled={busy || !name.ready || !d.username}
          onClick={async () => {
            if (!d.username) return;
            setBusy(true);
            try {
              await addFn({ data: { first: d.first.trim(), last: d.last.trim(), username: d.username, gender: d.gender, origin: d.origin, source: d.source } });
              toast.success(`Added ${d.first.trim()} ${d.last.trim()}`);
              onAdded();
              onClose();
            } catch (e: unknown) {
              toast.error(errorWords(e, "Couldn't add it"));
            } finally {
              setBusy(false);
            }
          }}
        >
          Add {d.first.trim() || "account"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
