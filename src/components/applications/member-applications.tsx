/**
 * The coach's member applications (Applications → Members): who applied for
 * free membership, the ones still waiting on a first message first, each
 * opening a sheet with their answers, every way to reach them, private notes,
 * where the conversation stands, and Approve / Decline / Flag. Approving
 * emails their activation link and hands back the same link to DM or text.
 * The funnel card on top says how people find and join.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Flag,
  Instagram,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  Send,
  UserCheck,
  X,
  Archive,
  ArchiveRestore,
  BellRing,
  ClipboardList,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { dialable, igDmHref, smsHref } from "@/lib/coaching-leads";
import {
  approveMemberApplication,
  declineMemberApplication,
  getMemberActivationLink,
  reopenMemberApplication,
  resendMemberInvite,
  updateMemberApplication,
  archiveMemberApplication,
  type ApproveResult,
} from "@/lib/membership-applications.functions";
import { replyMemberSupport } from "@/lib/member-support.functions";
import {
  LIFECYCLE, NO_FACTS, applicantActions, applicantConcerns, lifecycleStage, stageLabel,
  type ApplicantFacts, type LifecycleStage,
} from "@/lib/applications/lifecycle";
import {
  COACHING_INTEREST,
  MEMBER_STEPS,
  applicationLine,
  applicationStage,
  awaitingActivation,
  contactLabelOf,
  experienceLabelOf,
  firstNameFrom,
  funnelRows,
  goalLabelOf,
  hiMessage,
  instagramProfileUrl,
  needsFirstReply,
  type ContactStatus,
  type MemberApplication,
} from "@/lib/membership-apply";
import {
  MEMBER_APPLICATIONS_KEY,
  useJoinFunnel,
  useMemberApplications,
} from "@/components/applications/use-member-applications";
import { chatAge } from "@/components/messages/chat-list-row";

function initials(name: string | null | undefined) {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const ago = (iso: string | null | undefined) =>
  iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : "";

const STAGE_TONE: Record<LifecycleStage, "new" | "warn" | "done" | "muted"> = {
  new: "new", awaiting_review: "warn", awaiting_response: "muted", approved: "done", awaiting_payment: "warn",
  onboarding: "muted", ready: "muted", active: "done", archived: "muted",
};

/** Where they are on the path (lifecycle.ts), from what happened. */
function StageChip({ app, facts = NO_FACTS }: { app: MemberApplication; facts?: ApplicantFacts }) {
  const stage = lifecycleStage(app, facts);
  const s = { label: stageLabel(stage), tone: STAGE_TONE[stage] };
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        s.tone === "new" && "bg-secondary text-foreground",
        s.tone === "warn" && "bg-warning/15 text-warning",
        s.tone === "done" && "bg-success/15 text-success",
        s.tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {s.label}
    </span>
  );
}

function ApplicationRow({ app, onOpen, facts }: { app: MemberApplication; onOpen: () => void; facts?: ApplicantFacts }) {
  const coaching = app.coaching_interest === "yes" || app.coaching_interest === "maybe";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[72px] w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-secondary/40 active:bg-secondary/60"
      data-member-application={app.id}
    >
      <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-muted text-[15px] font-semibold">
        {initials(app.full_name)}
        {needsFirstReply(app) && (
          <span
            className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-blue-500 ring-2 ring-background"
            aria-label="Needs a first message"
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[16px] font-semibold">{app.full_name}</span>
          <StageChip app={app} facts={facts} />
        </span>
        <span className="mt-0.5 block truncate text-[14px] text-muted-foreground">
          {applicationLine(app)}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-muted-foreground">
          <span>{contactLabelOf(app.contact_method)}</span>
          <span aria-hidden>·</span>
          <span>{chatAge(app.created_at)}</span>
          {coaching && (
            <>
              <span aria-hidden>·</span>
              <span className="font-semibold text-foreground">
                {app.coaching_interest === "yes" ? "Wants coaching" : "Coaching maybe"}
              </span>
            </>
          )}
        </span>
      </span>
    </button>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-[16px] font-semibold">
        {title}
        {count ? ` · ${count}` : ""}
      </h2>
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
        {children}
      </div>
    </section>
  );
}

export function MemberApplicationsPanel({ focusId }: { focusId?: string }) {
  const { isLoading, enabled, pending, invited, starting, done, all, factsFor } = useMemberApplications();
  const [openId, setOpenId] = useState<string | null>(focusId ?? null);
  const [showEarlier, setShowEarlier] = useState(false);
  useEffect(() => {
    if (focusId) setOpenId(focusId);
  }, [focusId]);
  const open = all.find((a) => a.id === openId) ?? null;

  if (!enabled)
    return <p className="text-sm text-muted-foreground">Applications are for the admin login.</p>;
  return (
    <div className="space-y-6" data-member-applications>
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      ) : (
        <>
          {pending.length === 0 ? (
            <section className="space-y-2">
              <h2 className="text-[16px] font-semibold">Waiting on you</h2>
              <p className="text-[14px] text-muted-foreground">
                Nobody's waiting. New applications show up here, and you get one push for each
                burst.
              </p>
            </section>
          ) : (
            <Section title="Waiting on you" count={pending.length}>
              {pending.map((a) => (
                <ApplicationRow key={a.id} app={a} facts={factsFor(a.id)} onOpen={() => setOpenId(a.id)} />
              ))}
            </Section>
          )}
          {invited.length > 0 && (
            <Section title="Approved, not in yet" count={invited.length}>
              {invited.map((a) => (
                <ApplicationRow key={a.id} app={a} facts={factsFor(a.id)} onOpen={() => setOpenId(a.id)} />
              ))}
            </Section>
          )}
          {starting.length > 0 && (
            <Section title="Getting started" count={starting.length}>
              {starting.map((a) => (
                <ApplicationRow key={a.id} app={a} facts={factsFor(a.id)} onOpen={() => setOpenId(a.id)} />
              ))}
            </Section>
          )}
          {done.length > 0 && (
            <section className="space-y-2">
              <button
                type="button"
                onClick={() => setShowEarlier((v) => !v)}
                className="flex min-h-10 items-center gap-1.5 text-[16px] font-semibold"
              >
                Earlier · {done.length}
                {showEarlier ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
              {showEarlier && (
                <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
                  {done.map((a) => (
                    <ApplicationRow key={a.id} app={a} facts={factsFor(a.id)} onOpen={() => setOpenId(a.id)} />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
      <FunnelCard />
      <ApplicationSheet app={open} facts={open ? factsFor(open.id) : NO_FACTS} onClose={() => setOpenId(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One applicant                                                        */
/* ------------------------------------------------------------------ */

const CONTACT_STATUSES: Array<{ v: ContactStatus; l: string }> = [
  { v: "not_contacted", l: "Not yet" },
  { v: "messaged", l: "Messaged" },
  { v: "talking", l: "Talking" },
];

function useApplicationActions(id: string | null) {
  const qc = useQueryClient();
  const update = useServerFn(updateMemberApplication);
  const approve = useServerFn(approveMemberApplication);
  const decline = useServerFn(declineMemberApplication);
  const reopen = useServerFn(reopenMemberApplication);
  const resend = useServerFn(resendMemberInvite);
  const getLink = useServerFn(getMemberActivationLink);
  const refresh = () => qc.invalidateQueries({ queryKey: MEMBER_APPLICATIONS_KEY });
  const run = async <T,>(fn: () => Promise<T>, done?: string): Promise<T | null> => {
    try {
      const r = await fn();
      if (done) toast.success(done);
      await refresh();
      return r;
    } catch (e: any) {
      toast.error(e?.message ?? "That didn't work. Try again.");
      return null;
    }
  };
  return {
    patch: (
      p: { admin_notes?: string | null; contact_status?: ContactStatus; flagged?: boolean },
      done?: string,
    ) => (id ? run(() => update({ data: { id, ...p } }), done) : Promise.resolve(null)),
    approve: () => (id ? run(() => approve({ data: { id } })) : Promise.resolve(null)),
    decline: () =>
      id
        ? run(() => decline({ data: { id } }), "Declined. Only you can see that.")
        : Promise.resolve(null),
    reopen: () =>
      id ? run(() => reopen({ data: { id } }), "Back to waiting") : Promise.resolve(null),
    resend: () =>
      id ? run(() => resend({ data: { id } }), "Invite emailed again") : Promise.resolve(null),
    link: () => (id ? run(() => getLink({ data: { id } })) : Promise.resolve(null)),
  };
}

/** A message with every way to send it: Copy, then DM / Text / Email straight from the phone. */
function SendRow({
  text,
  app,
  onSent,
  primary,
  emailSubject,
}: {
  text: string;
  app: MemberApplication;
  onSent?: () => void;
  primary?: "instagram" | "text" | "email";
  emailSubject: string;
}) {
  const ig = igDmHref(app.instagram);
  const sms = smsHref(app.phone, text);
  const mail = `mailto:${encodeURIComponent(app.email)}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(text)}`;
  const variant = (k: "instagram" | "text" | "email") => (primary === k ? "secondary" : "outline");
  return (
    <div className="space-y-2">
      <div className="select-text whitespace-pre-wrap rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-[15px] leading-[1.45]">
        {text}
      </div>
      <div className="flex flex-wrap gap-2">
        {ig && (
          <Button
            type="button"
            variant={variant("instagram")}
            className="h-10"
            onClick={async () => {
              // Instagram can't take the words in its link: copy them first
              await copyText(text);
              toast.success("Copied. Paste it in the DM.");
              onSent?.();
              window.open(ig, "_blank", "noopener");
            }}
          >
            <Instagram className="mr-1.5 h-4 w-4" /> DM
          </Button>
        )}
        {sms && (
          <Button asChild type="button" variant={variant("text")} className="h-10">
            <a href={sms} onClick={() => onSent?.()}>
              <MessageSquare className="mr-1.5 h-4 w-4" /> Text
            </a>
          </Button>
        )}
        <Button asChild type="button" variant={variant("email")} className="h-10">
          <a href={mail} onClick={() => onSent?.()}>
            <Mail className="mr-1.5 h-4 w-4" /> Email
          </a>
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-10"
          onClick={async () => {
            if (await copyText(text)) toast.success("Copied");
            else toast.error("Couldn't copy. Press and hold the text to copy it.");
          }}
        >
          <Copy className="mr-1.5 h-4 w-4" /> Copy
        </Button>
      </div>
    </div>
  );
}

function Answer({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <span className="text-[14px] text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-[15px] font-medium">{value}</span>
    </div>
  );
}

function ApplicationSheet({
  app,
  facts = NO_FACTS,
  onClose,
}: {
  app: MemberApplication | null;
  facts?: ApplicantFacts;
  onClose: () => void;
}) {
  const actions = useApplicationActions(app?.id ?? null);
  const [notes, setNotes] = useState("");
  const [savedNotes, setSavedNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [invite, setInvite] = useState<{
    link: string;
    message: string;
    emailed?: boolean;
    emailProblem?: string | null;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setNotes(app?.admin_notes ?? "");
    setSavedNotes(app?.admin_notes ?? "");
    setInvite(null);
    // a different applicant only: a refetch of the same one keeps what's typed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app?.id]);

  const saveNotes = async (value: string) => {
    if (value === savedNotes) return;
    const r = await actions.patch({ admin_notes: value.trim() ? value : null });
    if (r) setSavedNotes(value);
  };
  useEffect(() => {
    if (!app || notes === savedNotes) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveNotes(notes), 900);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  const hi = useMemo(() => (app ? hiMessage(app) : ""), [app]);
  if (!app) return <Sheet open={false} onOpenChange={() => {}} />;

  const first = firstNameFrom(app.full_name) || "them";
  const profile = instagramProfileUrl(app.instagram);
  const tel = dialable(app.phone);
  const stage = applicationStage(app);
  const lifecycle = lifecycleStage(app, facts);
  const concerns = applicantConcerns(app, facts);
  const quick = applicantActions(app, facts);
  const clientId = facts.clientId ?? app.client_id;
  const pending = app.status === "pending";
  const waitingToJoin = awaitingActivation(app);
  const markMessaged = () => {
    if (app.contact_status === "not_contacted") void actions.patch({ contact_status: "messaged" });
  };

  const approve = async () => {
    setBusy("approve");
    const r = (await actions.approve()) as ApproveResult | null;
    setBusy(null);
    if (!r) return;
    if (r.kind === "invited") {
      setInvite({
        link: r.link,
        message: r.message,
        emailed: r.emailed,
        emailProblem: r.emailProblem,
      });
      toast.success(
        r.emailed
          ? `Approved. ${first}'s invite is in their email.`
          : `Approved. ${r.emailProblem ?? "The email didn't go"}: send the link below.`,
      );
    } else if (r.kind === "has_account") {
      toast.success(`Approved. ${first} already has an account: they just sign in.`);
    } else {
      toast.message(
        `A coaching record already uses this email. Send ${first} their setup link from their profile.`,
      );
    }
  };
  const showLink = async () => {
    setBusy("link");
    const r = (await actions.link()) as { link: string; message: string } | null;
    setBusy(null);
    if (r) setInvite(r);
  };

  return (
    <Sheet open={!!app} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        swipeToClose
        hideCloseButton
        className="flex max-h-[92dvh] flex-col gap-0 rounded-t-[22px] p-0 sm:mx-auto sm:max-w-[560px]"
        data-application-sheet={app.id}
      >
        <SheetHeader className="shrink-0 space-y-0 border-b border-border/60 px-4 pb-3 pt-2 text-left">
          <span
            className="mx-auto mb-2 block h-1 w-9 rounded-full bg-muted-foreground/30"
            aria-hidden
          />
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-muted text-[16px] font-semibold">
              {initials(app.full_name)}
            </span>
            <div className="min-w-0 flex-1">
              <SheetTitle className="flex items-center gap-2 text-[18px] font-semibold">
                <span className="truncate">{app.full_name}</span>
                <StageChip app={app} facts={facts} />
              </SheetTitle>
              <SheetDescription className="text-[13px]">
                Applied {ago(app.created_at)}
              </SheetDescription>
            </div>
            <SheetClose
              className="-mr-1.5 grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground active:bg-muted"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </SheetClose>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
          {/* Where they are on the path, read from what happened */}
          <ol className="flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none]" aria-label="Where they are" data-application-lifecycle={lifecycle}>
            {LIFECYCLE.filter((st) => st.key !== "awaiting_payment" || lifecycle === "awaiting_payment").map((st) => {
              const at = LIFECYCLE.findIndex((x) => x.key === lifecycle);
              const idx = LIFECYCLE.findIndex((x) => x.key === st.key);
              return (
                <li
                  key={st.key}
                  aria-current={st.key === lifecycle ? "step" : undefined}
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    st.key === lifecycle ? "bg-foreground text-background" : idx < at && lifecycle !== "archived" ? "bg-secondary text-foreground" : "text-muted-foreground",
                  )}
                >
                  {st.label}
                </li>
              );
            })}
          </ol>

          {/* Cleo's read: what's missing and what to watch (code, from their answers and what happened) */}
          {concerns.length > 0 && (
            <div className="rounded-2xl border border-border bg-secondary/30 p-3" data-applicant-concerns>
              <div className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" /> Cleo's read
              </div>
              <ul className="list-disc space-y-0.5 pl-5 text-[14px] leading-5">
                {concerns.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </div>
          )}

          {/* Quick actions: only the ones that do something where they are
              (Approve and Resend invitation are this sheet's own buttons below, once each) */}
          <QuickActions app={app} first={first} clientId={clientId} quick={quick.filter((q) => q !== "approve" && q !== "resend")} />

          {/* Their answers */}
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
            <Answer label="Goal" value={goalLabelOf(app.goal)} />
            <Answer label="Experience" value={experienceLabelOf(app.experience)} />
            <Answer
              label="1:1 coaching"
              value={
                app.coaching_interest ? (
                  <span className={cn(app.coaching_interest === "yes" && "text-success")}>
                    {COACHING_INTEREST.find((c) => c.v === app.coaching_interest)?.l}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Skipped</span>
                )
              }
            />
            <Answer label="Reach them by" value={contactLabelOf(app.contact_method)} />
            {app.source_page || app.utm_source || app.referrer ? (
              <Answer
                label="Came from"
                value={
                  <span className="text-muted-foreground">
                    {app.utm_source || app.source_page || app.referrer}
                  </span>
                }
              />
            ) : null}
          </div>

          {/* Every way to reach them */}
          <div className="space-y-2">
            <h3 className="text-[13px] font-semibold text-muted-foreground">Contact</h3>
            <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
              {app.instagram && (
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="flex min-w-0 items-center gap-2 text-[15px]">
                    <Instagram className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {profile ? (
                      <a
                        href={profile}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate font-medium underline-offset-4 hover:underline"
                        data-ig-profile
                      >
                        {app.instagram}
                      </a>
                    ) : (
                      <span className="truncate">{app.instagram}</span>
                    )}
                  </span>
                  {profile && (
                    <Button asChild variant="ghost" className="h-9 px-3 text-[13px]">
                      <a href={profile} target="_blank" rel="noopener noreferrer">
                        Open profile
                      </a>
                    </Button>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="flex min-w-0 items-center gap-2 text-[15px]">
                  <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{app.email}</span>
                </span>
                <Button
                  variant="ghost"
                  className="h-9 px-3 text-[13px]"
                  onClick={async () => (await copyText(app.email)) && toast.success("Email copied")}
                >
                  Copy
                </Button>
              </div>
              {app.phone && (
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="flex min-w-0 items-center gap-2 text-[15px]">
                    <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{app.phone}</span>
                  </span>
                  {tel && (
                    <Button asChild variant="ghost" className="h-9 px-3 text-[13px]">
                      <a href={`tel:${tel}`}>Call</a>
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Approved: get them in */}
          {(invite || waitingToJoin) && (
            <div className="space-y-2" data-invite-tools>
              <h3 className="text-[13px] font-semibold text-muted-foreground">
                {invite?.emailed === false
                  ? `${invite.emailProblem ?? "The email didn't go"}: send ${first} the link`
                  : `Send ${first} the link too`}
              </h3>
              {invite ? (
                <SendRow
                  text={invite.message}
                  app={app}
                  primary={app.contact_method as any}
                  emailSubject="You're approved for JF Effect"
                />
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10"
                  onClick={showLink}
                  disabled={busy === "link"}
                >
                  {busy === "link" ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-1.5 h-4 w-4" />
                  )}
                  Get their invite link
                </Button>
              )}
              {waitingToJoin && (
                <p className="text-[13px] text-muted-foreground">
                  {app.invite_sent_at ? `Invite emailed ${ago(app.invite_sent_at)}. ` : ""}A DM'd or
                  texted link asks them for a code from their email first, so it only works for
                  them.{" "}
                  <button
                    type="button"
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                    onClick={() => void actions.resend()}
                  >
                    Email it again
                  </button>
                </p>
              )}
            </div>
          )}

          {app.activated_at && (
            <div className="rounded-2xl border border-border p-4 text-[15px]">
              <span className="font-semibold text-success">Joined {ago(app.activated_at)}.</span>{" "}
              {app.client_id && (
                <Link
                  to="/admin/clients/$id"
                  params={{ id: app.client_id }}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  Open their profile
                </Link>
              )}
            </div>
          )}
          {app.existing_account && !app.activated_at && (
            <p className="rounded-2xl border border-border p-4 text-[14px] text-muted-foreground">
              This email already has a JF Effect account, so there's nothing to activate. They sign
              in as usual.
            </p>
          )}

          {/* Say hi before deciding */}
          {pending && (
            <div className="space-y-2">
              <h3 className="text-[13px] font-semibold text-muted-foreground">Say hi to {first}</h3>
              <SendRow
                text={hi}
                app={app}
                onSent={markMessaged}
                primary={app.contact_method as any}
                emailSubject="Your JF Effect application"
              />
            </div>
          )}

          {/* Where the conversation stands */}
          {app.status !== "declined" && !app.activated_at && (
            <div className="space-y-2">
              <h3 className="text-[13px] font-semibold text-muted-foreground">Conversation</h3>
              <div
                className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1"
                role="radiogroup"
                aria-label="Conversation"
              >
                {CONTACT_STATUSES.map((c) => (
                  <button
                    key={c.v}
                    type="button"
                    role="radio"
                    aria-checked={app.contact_status === c.v}
                    onClick={() =>
                      app.contact_status !== c.v && void actions.patch({ contact_status: c.v })
                    }
                    className={cn(
                      "h-9 rounded-lg text-[14px] font-medium transition",
                      app.contact_status === c.v
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground",
                    )}
                  >
                    {c.l}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Private notes */}
          <div className="space-y-2">
            <h3 className="flex items-center justify-between text-[13px] font-semibold text-muted-foreground">
              <span>Your notes · only you see these</span>
              {notes !== savedNotes ? (
                <span>Saving…</span>
              ) : notes ? (
                <span className="text-success">Saved</span>
              ) : null}
            </h3>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 4000))}
              onBlur={() => void saveNotes(notes)}
              placeholder="What you learned, what they need, a follow-up…"
              className="min-h-[88px] text-[16px]"
              data-application-notes
            />
          </div>

          {/* The decision */}
          <div className="space-y-2 border-t border-border pt-4">
            {pending ? (
              <>
                <Button
                  type="button"
                  className="h-12 w-full text-[16px]"
                  onClick={approve}
                  disabled={!!busy}
                  data-approve
                >
                  {busy === "approve" ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : (
                    <UserCheck className="mr-2 h-5 w-5" />
                  )}
                  Approve and send invite
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={() =>
                      void actions.patch(
                        { flagged: !app.flagged },
                        app.flagged ? "Unflagged" : "Flagged for a closer look",
                      )
                    }
                  >
                    <Flag className="mr-1.5 h-4 w-4" /> {app.flagged ? "Unflag" : "Flag"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={async () => {
                      setBusy("decline");
                      await actions.decline();
                      setBusy(null);
                    }}
                    disabled={!!busy}
                  >
                    <X className="mr-1.5 h-4 w-4" /> Decline
                  </Button>
                </div>
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  Approving emails {first} a link to set a password. Declining sends nothing, and
                  only you see it.
                </p>
              </>
            ) : app.activated_at ? null : (
              <Button
                type="button"
                variant="ghost"
                className="h-10 px-2 text-[14px]"
                onClick={() => void actions.reopen()}
              >
                {app.status === "declined" ? "Undo decline" : "Move back to waiting"}
              </Button>
            )}
            <p className="pt-1 text-[12px] text-muted-foreground">
              {stage.label} · applied{" "}
              {new Date(app.created_at).toLocaleDateString("en-CA", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* The funnel                                                           */
/* ------------------------------------------------------------------ */

const STEP_LABEL: Record<string, string> = {
  goal: "Goal",
  experience: "Experience",
  coaching_interest: "Coaching",
  full_name: "Name",
  contact_method: "How to reach",
  contact: "Contact details",
};

function FunnelCard() {
  const [days, setDays] = useState(30);
  const [more, setMore] = useState(false);
  const { data, isLoading, isError } = useJoinFunnel(days);
  return (
    <Card className="p-4" data-join-funnel>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[16px] font-semibold">How people join</h2>
        <div className="flex gap-1 rounded-lg bg-muted p-0.5" role="radiogroup" aria-label="Period">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={days === d}
              onClick={() => setDays(d)}
              className={cn(
                "h-8 rounded-md px-2.5 text-[13px] font-medium",
                days === d ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>
      {isLoading ? (
        <Skeleton className="mt-3 h-40 w-full rounded-xl" />
      ) : isError || !data ? (
        <p className="mt-3 text-[14px] text-muted-foreground">Couldn't load the numbers.</p>
      ) : (
        <>
          <ul className="mt-3 space-y-2.5">
            {funnelRows(data).map((r) => {
              const max = Math.max(1, data.visitors, data.starts, data.submitted);
              return (
                <li key={r.key} title={r.hint}>
                  <div className="flex items-baseline justify-between gap-3 text-[14px]">
                    <span>{r.label}</span>
                    <span className="tabular-nums">
                      <span className="font-semibold">{r.value}</span>
                      {r.rate !== null && (
                        <span className="ml-1.5 text-[12px] text-muted-foreground">{r.rate}%</span>
                      )}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-foreground/70"
                      style={{ width: `${Math.min(100, (r.value / max) * 100)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[13px] text-muted-foreground">
            {data.pending} waiting on you now · {data.coaching_interest} interested in coaching
          </p>
          <button
            type="button"
            onClick={() => setMore((v) => !v)}
            className="mt-2 min-h-9 text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            {more ? "Less" : "Where people stop, and where they come from"} ›
          </button>
          {more && (
            <div className="mt-2 grid gap-4 text-[13px] sm:grid-cols-2">
              <div>
                <div className="font-semibold">Reached each question</div>
                <ul className="mt-1.5 space-y-1">
                  {MEMBER_STEPS.map((s) => (
                    <li key={s} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{STEP_LABEL[s]}</span>
                      <span className="tabular-nums">{data.steps[s] ?? 0}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="font-semibold">Where applications came from</div>
                <ul className="mt-1.5 space-y-1">
                  {data.sources.length === 0 ? (
                    <li className="text-muted-foreground">None yet</li>
                  ) : (
                    data.sources.map((s) => (
                      <li key={s.source} className="flex justify-between gap-2">
                        <span className="truncate text-muted-foreground">{s.source}</span>
                        <span className="tabular-nums">{s.count}</span>
                      </li>
                    ))
                  )}
                </ul>
                <div className="mt-3 font-semibold">First week, of those who joined</div>
                <ul className="mt-1.5 space-y-1">
                  <li className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Started a program</span>
                    <span className="tabular-nums">{data.started_program}</span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Finished a workout</span>
                    <span className="tabular-nums">{data.trained}</span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Posted in the Crew</span>
                    <span className="tabular-nums">{data.posted}</span>
                  </li>
                </ul>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * One applicant's quick actions: Message (their Support chat in Messages),
 * Review intake / Open client (their profile), Start onboarding (a setup
 * reminder in their Support chat, sent by you), Archive. lifecycle.ts decides
 * which apply; Approve and Resend invitation are the sheet's own buttons.
 */
function QuickActions({
  app, first, clientId, quick,
}: {
  app: MemberApplication;
  first: string;
  clientId: string | null;
  quick: ReturnType<typeof applicantActions>;
}) {
  const qc = useQueryClient();
  const archive = useServerFn(archiveMemberApplication);
  const reply = useServerFn(replyMemberSupport);
  const [working, setWorking] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setWorking(key);
    try {
      await fn();
      toast.success(ok);
      await qc.invalidateQueries({ queryKey: MEMBER_APPLICATIONS_KEY });
    } catch (e: any) {
      toast.error(e?.message ?? "That didn't work. Try again.");
    } finally {
      setWorking(null);
    }
  };
  if (!quick.length) return null;
  const btn = "h-9 px-3 text-[13px]";
  return (
    <div className="flex flex-wrap gap-1.5" data-applicant-actions>
      {quick.includes("message") && clientId && (
        <Button asChild variant="secondary" className={btn} data-quick="message">
          <Link to="/admin/communication" search={{ tab: "messages", client: clientId } as any}><MessageSquare className="mr-1.5 h-4 w-4" /> Message</Link>
        </Button>
      )}
      {quick.includes("review_intake") && clientId && (
        <Button asChild variant="secondary" className={btn} data-quick="review_intake">
          <Link to="/admin/clients/$id" params={{ id: clientId }}><ClipboardList className="mr-1.5 h-4 w-4" /> Review intake</Link>
        </Button>
      )}
      {quick.includes("start_onboarding") && clientId && (
        <Button
          variant="secondary"
          className={btn}
          disabled={working === "onboarding"}
          onClick={() => void run(
            "onboarding",
            () => reply({ data: { clientId, body: `Hi ${first}! One quick step left to finish setting up: open the app and pick the days you train. It takes under a minute.` } }),
            `Setup reminder sent to ${first} in their Support chat`,
          )}
          data-quick="start_onboarding"
        >
          <BellRing className="mr-1.5 h-4 w-4" /> Start onboarding
        </Button>
      )}
      {quick.includes("archive") && (
        <Button variant="ghost" className={btn} disabled={working === "archive"} onClick={() => void run("archive", () => archive({ data: { id: app.id, archived: true } }), "Archived. It's kept under Earlier.")} data-quick="archive">
          <Archive className="mr-1.5 h-4 w-4" /> Archive
        </Button>
      )}
      {quick.includes("unarchive") && (
        <Button variant="ghost" className={btn} disabled={working === "archive"} onClick={() => void run("archive", () => archive({ data: { id: app.id, archived: false } }), "Back in your lists")} data-quick="unarchive">
          <ArchiveRestore className="mr-1.5 h-4 w-4" /> Unarchive
        </Button>
      )}
      {quick.includes("open_client") && clientId && (
        <Button asChild variant="ghost" className={btn} data-quick="open_client">
          <Link to="/admin/clients/$id" params={{ id: clientId }}><ExternalLink className="mr-1.5 h-4 w-4" /> Open client</Link>
        </Button>
      )}
    </div>
  );
}
