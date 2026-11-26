/**
 * Premium's pieces in the app (premium.ts): whether the signed-in person has
 * it, Build with Cleo (a program drafted from their profile into the builder,
 * unsaved, everything editable) and the Cleo inbox (welcome, weekly recaps).
 * Each is nothing for someone without Premium, which today is everyone
 * but a complimentary grant, and nothing for a self-serve member in the
 * iPhone app (option B, native-purchases.ts: hidden, never shown locked).
 */
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CleoAvatar } from "@/components/summer/cleo-avatar";
import type { PinnedChat } from "@/components/group-chats-pane";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useDigitalPaidAllowed } from "@/lib/service-tier";
import { GOALS, LEVELS, type ProgramGoal, type ProgramLevel } from "@/lib/athlete-programs";
import { draftBackupKey, type DraftBackup } from "@/lib/athlete-program-draft";
import { useBuilderExerciseLibrary } from "@/lib/builder-exercise-library";
import { getMySetupStatus } from "@/lib/member-setup.functions";
import { getMyPremium, listMyCleoInbox, markCleoInboxRead } from "@/lib/premium/premium.functions";
import { unreadCount, type CleoInboxItem } from "@/lib/premium/premium";
import { briefFromProfile, buildCleoDraft, type CleoBrief } from "@/lib/premium/cleo-build";

export function usePremium(): boolean {
  const { user } = useAuth();
  const allowed = useDigitalPaidAllowed();
  const fn = useServerFn(getMyPremium);
  const q = useQuery({
    queryKey: ["my-premium", user?.id ?? null],
    queryFn: () => fn(),
    enabled: !!user?.id && allowed,
    staleTime: 10 * 60_000,
  });
  return allowed && q.data?.premium === true;
}

/* ───────────────────────── Build with Cleo ───────────────────────── */

/** The Premium row in the program start options; nothing for anyone else. */
export function BuildWithCleoRow({ className }: { className?: string }) {
  const premium = usePremium();
  const [open, setOpen] = useState(false);
  if (!premium) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-start-way="cleo"
        className={cn(
          "flex min-h-[64px] w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition hover:bg-secondary/40 active:bg-secondary/60",
          className,
        )}
      >
        <CleoAvatar size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium">Build with Cleo</span>
          <span className="block text-[13px] leading-snug text-muted-foreground">Cleo drafts it from your goal, experience and days. You change anything before you start.</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      <BuildWithCleoSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

function Chips<T extends string | number>({ options, value, onChange, label }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={String(o.id)}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onChange(o.id)}
            className={cn(
              "min-h-[40px] rounded-full px-3.5 text-[14px] font-medium transition",
              value === o.id ? "bg-foreground text-background" : "bg-muted/70 ring-1 ring-border/70 hover:bg-muted",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function BuildWithCleoSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const setupFn = useServerFn(getMySetupStatus);
  const setup = useQuery({ queryKey: ["member-setup-status"], queryFn: () => setupFn(), enabled: open, staleTime: 60_000 });
  const library = useBuilderExerciseLibrary();
  const fromProfile = useMemo(() => briefFromProfile((setup.data?.member ?? {}) as any), [setup.data]);
  const [brief, setBrief] = useState<CleoBrief | null>(null);
  const b = brief ?? fromProfile;
  const set = (patch: Partial<CleoBrief>) => setBrief({ ...b, ...patch });
  const [note, setNote] = useState<string | null>(null);

  const draft = () => {
    if (!user?.id || !library.data) return;
    const { draft, missing } = buildCleoDraft(b, library.data as any);
    if (!draft.plan.blocks[0]?.weeks[0]?.days.some((d) => d.exercises.length)) {
      setNote("I couldn't find the exercises for this in the library. Try Build my own instead.");
      return;
    }
    // the builder picks this up as the half-built program on this phone: nothing is saved or started yet
    const backup: DraftBackup = { v: 2, base: null, savedAt: Date.now(), draft };
    try {
      localStorage.setItem(draftBackupKey(user.id, null), JSON.stringify(backup));
    } catch {
      setNote("This phone wouldn't keep the draft. Free up some space and try again.");
      return;
    }
    if (missing.length) setNote(`Not in the library, so left out: ${missing.join(", ")}.`);
    onOpenChange(false);
    void navigate({ to: "/portal/programs/new" });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[92dvh] max-w-lg overflow-y-auto rounded-t-3xl pb-[max(env(safe-area-inset-bottom),1rem)]">
        <SheetHeader className="text-left">
          <div className="flex items-center gap-2.5">
            <CleoAvatar size="sm" />
            <SheetTitle>Build with Cleo</SheetTitle>
          </div>
          <SheetDescription>From your profile. Change any of it, then I'll draft it. It opens in the builder, unsaved, so every exercise, set and week is yours to change before you start.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 grid gap-4">
          <Chips label="Goal" options={GOALS} value={b.goal} onChange={(goal: ProgramGoal) => set({ goal })} />
          <Chips label="Experience" options={LEVELS} value={b.level} onChange={(level: ProgramLevel) => set({ level })} />
          <Chips label="Days a week" options={[2, 3, 4, 5].map((n) => ({ id: n, label: String(n) }))} value={b.days} onChange={(days: number) => set({ days })} />
          <Chips label="Weeks" options={[4, 8, 12].map((n) => ({ id: n, label: String(n) }))} value={b.weeks} onChange={(weeks: number) => set({ weeks })} />
          {note && <p className="text-[14px] text-muted-foreground">{note}</p>}
          <button
            type="button"
            onClick={draft}
            disabled={!library.data || setup.isLoading}
            className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-foreground px-6 text-[16px] font-semibold text-background disabled:opacity-60"
          >
            {!library.data || setup.isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Draft my program
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ───────────────────────── the Cleo inbox ───────────────────────── */

/**
 * A Premium member's Cleo chat, pinned in Messages after their coach and
 * Support (welcome, weekly recaps). Null for everyone else, so the inbox is
 * exactly as it was. `?cleo=1` (the recap's push) opens it.
 */
export function useCleoPin(): PinnedChat | null {
  const premium = usePremium();
  const fn = useServerFn(listMyCleoInbox);
  const readFn = useServerFn(markCleoInboxRead);
  const qc = useQueryClient();
  const inbox = useQuery({ queryKey: ["cleo-inbox"], queryFn: () => fn(), enabled: premium, staleTime: 60_000 });
  const [arrival] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("cleo") === "1");
  if (!premium || !inbox.data?.premium) return null;
  const items = inbox.data.items;
  const latest = items[0];
  return {
    id: "cleo",
    name: "Cleo",
    avatarUrl: null,
    preview: latest ? latest.title : "Your weekly recaps land here",
    at: latest?.created_at ?? null,
    unread: unreadCount(items) > 0,
    searchText: `Cleo recap week ${latest?.title ?? ""}`,
    openOnArrival: arrival,
    markRead: async () => {
      const ids = items.filter((i) => !i.read_at).map((i) => i.id);
      if (!ids.length) return;
      await readFn({ data: { ids } });
      void qc.invalidateQueries({ queryKey: ["cleo-inbox"] });
    },
    renderThread: ({ onBack }) => <CleoThread items={items} onBack={onBack} />,
  };
}

function CleoThread({ items, onBack }: { items: CleoInboxItem[]; onBack: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-cleo-inbox>
      <header className="flex items-center gap-2.5 border-b border-border bg-card/80 px-3 py-2 backdrop-blur md:px-6">
        <button type="button" onClick={onBack} aria-label="All chats" className="grid h-10 w-10 shrink-0 place-items-center rounded-full md:hidden">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <CleoAvatar size="sm" />
        <div className="min-w-0">
          <div className="text-[15px] font-semibold leading-tight">Cleo</div>
          <div className="text-[12px] text-muted-foreground">AI assistant · recaps from what you logged</div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6">
        <div className="mx-auto grid max-w-lg gap-4">
          {items.length === 0 && <p className="text-[15px] text-muted-foreground">Nothing yet. Your first recap lands the Monday after a week of training.</p>}
          {items.map((m) => (
            <InboxItem key={m.id} item={m} />
          ))}
        </div>
      </div>
    </div>
  );
}

function InboxItem({ item }: { item: CleoInboxItem }) {
  const when = new Date(item.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <article className="rounded-2xl bg-muted/50 p-4 ring-1 ring-border/60" data-cleo-item={item.kind}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[17px] font-semibold">{item.title}</h3>
        <span className="text-[12px] text-muted-foreground">{when}</span>
      </div>
      {item.cards.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {item.cards.map((c) => (
            <div key={c.key} className="rounded-xl bg-foreground p-3 text-background">
              <div className="text-[26px] font-bold leading-none tracking-tight tabular-nums">{c.value}</div>
              <div className="mt-1 text-[13px] font-medium opacity-80">{c.label}</div>
              {c.sub && <div className="mt-1 text-[12px] opacity-60">{c.sub}</div>}
            </div>
          ))}
        </div>
      )}
      {item.body && <p className="mt-3 text-[15px] leading-relaxed">{item.body}</p>}
    </article>
  );
}
