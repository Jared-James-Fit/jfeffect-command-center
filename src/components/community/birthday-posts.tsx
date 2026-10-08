import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Cake, Check, ChevronRight, Loader2, MessageCircle, RefreshCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import {
  useBirthdayAct, useBirthdayPosts, useBirthdaysNext, useDraftBirthdayNow,
  type BirthdayAction, type BirthdayNext, type BirthdayPost,
} from "@/lib/community.queries";

/** "Tomorrow", "Today", "Thu, Oct 9". */
function dayWord(iso: string, now = new Date()) {
  const d = new Date(`${iso}T12:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** When it goes out, in the coach's time ("8:00 AM"). */
export function postTime(b: Pick<BirthdayPost, "post_at">) {
  return new Date(b.post_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** …and theirs too when it's different ("7:00 AM (8:00 AM their time)"). */
export function postTimeLine(b: Pick<BirthdayPost, "post_at" | "person">) {
  const at = new Date(b.post_at);
  const mine = postTime(b);
  const myTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const theirs = b.person.timezone && b.person.timezone !== myTz ? at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: b.person.timezone }) : null;
  return theirs ? `${mine} (${theirs} their time)` : mine;
}

/** "Dec 21 · 74 days" (the card says drafts land at 5pm the day before). */
function nextLine(n: BirthdayNext) {
  if (n.days <= 0) return "Today";
  if (n.days === 1) return "Tomorrow";
  const d = new Date(`${n.birthday}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${d} · ${n.days} days`;
}

function statusLine(b: BirthdayPost) {
  const day = dayWord(b.birthday);
  if (b.status === "posted") return "Posted · message sent";
  if (b.status === "scheduled") return `${day} at ${postTime(b)}`;
  if (new Date(b.post_at).getTime() <= Date.now()) return "Today · ready to post";
  return `${day} · ready`;
}

/**
 * Coach dashboard: birthday posts. A draft in your voice lands the evening
 * before (with a push); review it here, and once you approve it goes out at
 * 8am on their birthday with a message to them. Between birthdays it shows
 * who's next and when their draft lands, with "Write it now" to see it early.
 * `#birthday=<client id>` (the push) opens that one straight away.
 */
export function BirthdayPostsCard() {
  const { data } = useBirthdayPosts();
  const { data: next = [] } = useBirthdaysNext();
  const draftNow = useDraftBirthdayNow();
  const [openId, setOpenId] = useState<string | null>(null);
  const items = (data ?? []).filter((b) => b.status !== "skipped");

  useEffect(() => {
    if (!data) return;
    const m = typeof window !== "undefined" ? window.location.hash.match(/birthday=([0-9a-f-]{36})/i) : null;
    if (!m) return;
    const hit = data.find((b) => b.client_id === m[1] || b.id === m[1]);
    if (hit) setOpenId(hit.id);
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }, [data]);

  if (items.length === 0 && next.length === 0) return null;
  const open = items.find((b) => b.id === openId) ?? null;
  const writeNow = async (n: BirthdayNext) => {
    try {
      const row = await draftNow.mutateAsync(n.client_id);
      setOpenId(row.id);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't write it. Try again.");
    }
  };
  const waiting = items.filter((b) => b.status === "ready").length;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-1 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-primary">
          <Cake className="h-4 w-4" />
        </span>
        <h2 className="text-[13px] font-bold tracking-tight">Birthday posts</h2>
        {waiting > 0 && <span className="rounded-full bg-primary px-1.5 py-px text-[10px] font-bold text-primary-foreground">{waiting} to review</span>}
      </div>
      <p className="mb-2 text-[12px] text-muted-foreground">
        Written in your voice from their numbers. Each draft lands at 5pm the day before, with a notification. Nothing goes out until you approve it.
      </p>
      <div className="divide-y divide-border/70">
        {items.map((b) => (
          <button key={b.id} type="button" onClick={() => setOpenId(b.id)} className="flex w-full items-center gap-3 py-2.5 text-left">
            <UserAvatar src={b.person.avatar_url} name={b.person.full_name || b.person.name} size={38} expandable={false} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-bold">{b.person.full_name || b.person.name}</div>
              <div className={cn("truncate text-[12px]", b.status === "ready" ? "font-semibold text-primary" : "text-muted-foreground")}>{statusLine(b)}</div>
            </div>
            {b.status === "ready" ? (
              <span className="shrink-0 rounded-full bg-primary px-3.5 py-1.5 text-[12px] font-black text-primary-foreground">Review</span>
            ) : (
              <>
                <span className="flex shrink-0 items-center gap-1 text-[12px] font-bold text-emerald-600 dark:text-emerald-400">
                  <Check className="h-4 w-4" /> {b.status === "posted" ? "Posted" : "Scheduled"}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </>
            )}
          </button>
        ))}
      </div>
      {next.length > 0 && (
        <div className={cn(items.length > 0 && "mt-2 border-t border-border/70 pt-2")}>
          <div className="pb-1 text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">Coming up</div>
          <div className="divide-y divide-border/70">
            {next.map((n) => {
              const busy = draftNow.isPending && draftNow.variables === n.client_id;
              return (
                <div key={n.client_id} className="flex items-center gap-3 py-2.5">
                  <UserAvatar src={n.person.avatar_url} name={n.person.full_name || n.person.name} size={38} expandable={false} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-bold">{n.person.full_name || n.person.name}</div>
                    <div className="truncate text-[12px] text-muted-foreground">{nextLine(n)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => writeNow(n)}
                    disabled={draftNow.isPending}
                    className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12px] font-bold hover:bg-muted disabled:opacity-60"
                  >
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {busy ? "Writing…" : "Write now"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <BirthdayPostSheet post={open} onClose={() => setOpenId(null)} />
    </section>
  );
}

/** A textarea that grows with its text (the post reads like it will in the feed). */
function GrowText({ value, onChange, className, label, max }: { value: string; onChange: (v: string) => void; className?: string; label: string; max: number }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value.slice(0, max))}
      maxLength={max}
      rows={2}
      aria-label={label}
      style={{ fontSize: 16 }}
      className={cn("block w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none", className)}
    />
  );
}

/**
 * Review one birthday post: the post as it'll look in the feed and the
 * message to them, both editable. New wording, skip, or approve (it goes
 * out at 8am on their birthday) / post now.
 */
export function BirthdayPostSheet({ post, onClose }: { post: BirthdayPost | null; onClose: () => void }) {
  const act = useBirthdayAct();
  const [body, setBody] = useState("");
  const [dm, setDm] = useState("");
  useEffect(() => {
    if (post) {
      setBody(post.body);
      setDm(post.dm_body);
    }
  }, [post?.id, post?.body, post?.dm_body]);

  const name = post?.person.name ?? "";
  const due = post ? new Date(post.post_at).getTime() <= Date.now() : false;
  const edited = !!post && (body !== post.body || dm !== post.dm_body);
  const run = (action: BirthdayAction, done?: string) => {
    if (!post) return;
    act.mutate(
      { id: post.id, action, body, dmBody: dm },
      {
        onSuccess: (row) => {
          if (done) toast.success(done);
          if (row.status === "posted" || row.status === "skipped") onClose();
        },
        onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
      },
    );
  };

  return (
    <Sheet open={!!post} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideCloseButton className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]">
        {post && (
          <>
            <SheetHeader className="relative space-y-0.5 border-b border-border/60 py-3 pl-5 pr-14 pt-4 text-left">
              <SheetClose className="absolute right-4 top-3.5 grid h-9 w-9 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
                <X className="h-4 w-4" />
              </SheetClose>
              <SheetTitle className="text-[17px] font-black">🎂 {name}'s birthday post</SheetTitle>
              <SheetDescription className="text-[12px]">
                {post.status === "posted"
                  ? "Posted, and your message went to them."
                  : post.status === "scheduled"
                    ? `Approved. Goes out ${dayWord(post.birthday).toLowerCase()} at ${postTimeLine(post)}, with your message to ${name}.`
                    : due
                      ? `It's their birthday. Post it now and ${name} gets your message too.`
                      : `${dayWord(post.birthday)}. Approve it and it goes out at ${postTimeLine(post)} on their birthday.`}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-4 px-5 py-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">Community post</span>
                  {post.status !== "posted" && (
                    <button
                      type="button"
                      disabled={act.isPending}
                      onClick={() => run("reroll")}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-bold text-muted-foreground hover:bg-muted disabled:opacity-50"
                    >
                      <RefreshCcw className="h-3.5 w-3.5" /> New wording
                    </button>
                  )}
                </div>
                <div className="rounded-2xl border border-border/70 bg-background p-4 shadow-sm">
                  <GrowText value={body} onChange={setBody} max={1200} label="Community post" className="whitespace-pre-wrap text-[15px] leading-[1.45]" />
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">Goes to the JF crew as you. Every number is from their training.</p>
              </div>

              <div>
                <div className="mb-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">Message to {name}</div>
                <div className="rounded-2xl bg-muted/60 p-3">
                  <GrowText value={dm} onChange={setDm} max={1000} label={`Message to ${name}`} className="text-[15px] leading-snug" />
                  <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-border/70 bg-background px-3 py-2">
                    <span className="text-[18px]">🎂</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-bold">Your birthday post</div>
                      <div className="truncate text-[11px] text-muted-foreground">{body.split("\n")[0]}</div>
                    </div>
                    <span className="text-[11px] font-bold text-primary">View</span>
                  </div>
                </div>
                <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <MessageCircle className="h-3 w-3" /> Lands in their Messenger with a tap-through to the post.
                </p>
              </div>
            </div>

            <div className="sticky bottom-0 space-y-2 border-t border-border/60 bg-background px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-3">
              {post.status === "posted" ? (
                post.post_id && (
                  <Link to="/admin/community" hash={`post=${post.post_id}`} className="flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-[15px] font-black text-primary-foreground">
                    View the post
                  </Link>
                )
              ) : post.status === "scheduled" ? (
                <>
                  {edited && (
                    <button type="button" disabled={act.isPending} onClick={() => run("approve", "Saved")} className="h-12 w-full rounded-2xl bg-primary text-[15px] font-black text-primary-foreground disabled:opacity-60">
                      Save changes
                    </button>
                  )}
                  <div className="flex gap-2">
                    <button type="button" disabled={act.isPending} onClick={() => run("post_now", `Posted. ${name} got your message`)} className="h-11 flex-1 rounded-2xl bg-muted text-[14px] font-bold disabled:opacity-60">
                      Post now instead
                    </button>
                    <button type="button" disabled={act.isPending} onClick={() => run("unschedule")} className="h-11 flex-1 rounded-2xl bg-muted text-[14px] font-bold disabled:opacity-60">
                      Unschedule
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={act.isPending || !body.trim() || !dm.trim()}
                    onClick={() => run(due ? "post_now" : "approve", due ? `Posted. ${name} got your message` : `Scheduled for ${dayWord(post.birthday).toLowerCase()} ${postTime(post)}`)}
                    className="h-12 w-full rounded-2xl bg-primary text-[15px] font-black text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-60"
                  >
                    {act.isPending ? "Saving…" : due ? `Post & message ${name}` : `Approve for ${dayWord(post.birthday).toLowerCase()} ${postTime(post)}`}
                  </button>
                  <div className="flex gap-2">
                    {!due && (
                      <button type="button" disabled={act.isPending} onClick={() => run("post_now", `Posted. ${name} got your message`)} className="h-11 flex-1 rounded-2xl bg-muted text-[14px] font-bold disabled:opacity-60">
                        Post now
                      </button>
                    )}
                    <button type="button" disabled={act.isPending} onClick={() => run("skip", "Skipped this year")} className="h-11 flex-1 rounded-2xl bg-muted text-[14px] font-bold text-muted-foreground disabled:opacity-60">
                      Skip this year
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
