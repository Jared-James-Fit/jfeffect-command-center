import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Heart, History, Loader2, Pencil, Power, Trash2, UserPlus } from "lucide-react";
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
import {
  clearVirtualLikesFn,
  createStarterVirtualAccountsFn,
  listVirtualAccountsFn,
  setVirtualSettingsFn,
  updateVirtualAccountFn,
  virtualActivityFn,
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
    onSuccess: (s) => {
      qc.setQueryData(KEY, (prev: any) => (prev ? { ...prev, settings: s } : prev));
      toast.success(s.automation_enabled ? "Automated likes are on" : "Automated likes are off");
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
        </ul>
      </Card>

      {canEdit && missing > 0 && (
        <Button className="h-11 w-full" disabled={create.isPending} onClick={() => create.mutate()} data-virtual-create>
          {create.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UserPlus className="mr-1.5 h-4 w-4" />}
          Add {missing} starter virtual account{missing === 1 ? "" : "s"}
        </Button>
      )}

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
  const [edit, setEdit] = useState(false);
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
          <div className="truncate text-xs text-muted-foreground">@{a.username ?? a.slug}</div>
          {a.bio && <p className="mt-1 text-sm">{a.bio}</p>}
          <div className="mt-1 text-xs text-muted-foreground">
            {a.likes_24h} like{a.likes_24h === 1 ? "" : "s"} today · {a.likes_total} in all · {a.followers} follower{a.followers === 1 ? "" : "s"}
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
          <Button variant="outline" size="sm" className="h-10" onClick={() => setEdit(true)}>
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
      {edit && <EditDialog a={a} onClose={() => setEdit(false)} onSave={(patch) => update.mutateAsync(patch).then(() => setEdit(false))} />}
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

function EditDialog({ a, onClose, onSave }: { a: VirtualAccount; onClose: () => void; onSave: (patch: Record<string, unknown>) => Promise<unknown> }) {
  const [first, setFirst] = useState(a.first_name);
  const [last, setLast] = useState(a.last_name ?? "");
  const [bio, setBio] = useState(a.bio ?? "");
  const [background, setBackground] = useState(a.background ?? "");
  const [notes, setNotes] = useState(a.notes ?? "");
  const [sports, setSports] = useState<string[]>(a.disciplines ?? []);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {a.first_name}</DialogTitle>
          <DialogDescription>Words only. A virtual account never gets a photo or media.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Input value={first} onChange={(e) => setFirst(e.target.value.slice(0, 40))} placeholder="First name" aria-label="First name" className="h-11" />
          <Input value={last} onChange={(e) => setLast(e.target.value.slice(0, 40))} placeholder="Last name" aria-label="Last name" className="h-11" />
        </div>
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
          disabled={busy || !first.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave({ first_name: first.trim(), last_name: last.trim(), bio: bio.trim(), background: background.trim(), notes: notes.trim(), disciplines: sports });
              toast.success("Saved");
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
