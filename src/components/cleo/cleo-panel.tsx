/**
 * Cleo's panel (Nov 24 2026): one place to talk to Cleo across admin, and it
 * never resets. Closing only puts it away (what's on screen, a half-typed
 * message and an answer being written all carry on), switching pages keeps the
 * conversation, and refreshing or coming back on another device restores the
 * most recent conversation for where the coach is.
 *
 *   Computer  a panel at the right the page makes room for (on a narrower
 *             screen it sits over the page's edge instead), docked or expanded;
 *             expanded, the conversations list stays open beside it.
 *   Phone     the whole screen, sitting on the visible part while typing.
 *
 * The small chip in the header says who the conversation is about (the page's
 * client, else General) and switches between that client and the general
 * conversation. Everything else (customize, auto-archive) is in ⋯.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ChevronDown, Maximize2, Menu, Minimize2, MoreHorizontal, SlidersHorizontal, SquarePen, User, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useIsMobileNow } from "@/hooks/use-mobile";
import { useVisualViewportBox } from "@/hooks/use-touch-viewport";
import { CleoMark } from "@/components/summer/cleo-mark";
import { CLEO_ROLE_LINE } from "@/components/summer/cleo-avatar";
import { getSummerProfile, summerSpeech } from "@/lib/business-books.functions";
import { getCleoArchiveSetting, saveCleoArchiveSetting, transcribeCleoDictation } from "@/lib/cleo-conversations.functions";
import { ARCHIVE_DAY_CHOICES, SECTION_LABEL, cleoPlaceFromLocation, type CleoChat } from "@/lib/cleo-chats";
import { CLEO_PANEL_OPENED, type SummerOpenDetail } from "@/lib/cleo-open";
import { draftKey, readDraft, writeDraft } from "@/lib/cleo-drafts";
import { loadVoicePrefs, summerSpeaker, type ServerVoice } from "@/lib/summer-speaker";
import { summerTone } from "@/lib/summer-persona";
import { phoneLayoutNow } from "@/lib/portrait-only";
import { feedback } from "@/lib/feedback";
import { ATTACH_ACCEPT } from "@/lib/cleo-attachments";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SummerCustomizeDialog } from "@/components/admin/books/summer-customize";
import { CleoApprovals, useCleoActions } from "@/components/admin/books/cleo-action-card";
import { AttachmentTray, useAttachmentTray } from "@/components/admin/books/cleo-attachments-ui";
import { CleoComposer, type CleoComposerHandle } from "./cleo-composer";
import { CleoThread } from "./cleo-thread";
import { CleoHistory } from "./cleo-history";
import { useOpenLink } from "./cleo-text";
import { useCleoConversation, type CleoMsg } from "./use-cleo-conversation";

const PREFS_KEY = "jf.cleo.panel.v1";
export const PANEL_DOCKED_W = 420;
/** The page keeps at least this much beside a docked panel; narrower, the panel sits over it. */
const PAGE_MIN_W = 720;

type Mode = "docked" | "expanded";

function readPrefs(): { open: boolean; mode: Mode } {
  try {
    const v = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "{}");
    return { open: v.open === true, mode: v.mode === "expanded" ? "expanded" : "docked" };
  } catch {
    return { open: false, mode: "docked" };
  }
}
function writePrefs(p: { open: boolean; mode: Mode }) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // private mode
  }
}

const OWNER_STARTERS = ["What's on my plate today?", "Who missed workouts this week?", "Which check-ins are waiting on me?", "Who still owes me money?"];
const TEAM_STARTERS = ["What's on the calendar today?", "Who missed workouts this week?", "Any pain flags in recent check-ins?", "Which check-ins are waiting?"];
const FINANCE_STARTERS = ["How much should be set aside for taxes right now?", "Who still owes money?", "What were this month's sales?", "Which expenses are missing a receipt?"];

function clientStarters(first: string, section: string | null): string[] {
  switch (section) {
    case "meetings": return ["Summarize the last meeting", "What decisions and follow-ups are on file?", "Show the attempts we discussed"];
    case "competition": return ["Review competition readiness", "Show discussed and approved attempts", "What needs a decision?"];
    case "billing": return ["Review payment history", "Explain the current plan", "Show outstanding payments"];
    case "goals": return ["Review pending goals", "Where did these proposals come from?", "Show approved targets"];
    case "forms": return ["Review recent forms", "Show missing responses"];
    case "notes": return ["Summarize relevant coach notes", "Find past decisions"];
    case "sessions": return ["Review session history", "What is coming up?"];
    case "details": return ["Review client information", "What is missing?"];
    case "coaching": return ["Review coaching setup", "What is still outstanding?"];
    case "documents": return ["Find client documents", "What is on file?"];
    case "account": return ["Review account setup", "What access issues are outstanding?"];
    case "nutrition":
      return [`How is ${first} doing on their nutrition plan?`, `Is ${first}'s bodyweight trend on track?`, `What would you change in ${first}'s plan?`];
    case "cardio":
      return [`Is ${first}'s cardio helping or hurting their recovery?`, `How consistent has ${first} been with cardio?`, `Suggest a better cardio week for ${first}`];
    case "builder":
    case "intelligence":
      return [`Review ${first}'s current program`, `Which lift is ${first} progressing slowest on?`, `Is ${first}'s weekly volume recoverable?`];
    case "analytics":
      return [`How is ${first} progressing this block?`, `What stands out in ${first}'s training lately?`, `Any recovery red flags for ${first}?`];
    case "checkins":
      return [`Summarize ${first}'s last check-in`, `What should I reply to ${first}?`, `Anything ${first} is struggling with?`];
    default:
      return [`How is ${first} doing?`, `What did ${first} train this week?`, `Anything I should follow up on with ${first}?`];
  }
}

export function CleoPanel() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const phone = useIsMobileNow();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const search = useRouterState({ select: (r) => r.location.search as Record<string, unknown> });
  const href = useRouterState({ select: (r) => r.location.href });
  const hash = useRouterState({ select: (r) => r.location.hash });
  const place = useMemo(() => cleoPlaceFromLocation(pathname, search), [pathname, search]);

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<Mode>("docked");
  const [showHistory, setShowHistory] = useState(false);
  const [year, setYear] = useState<number | undefined>(undefined);
  const [customizing, setCustomizing] = useState(false);
  const [vw, setVw] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
  const composer = useRef<CleoComposerHandle>(null);
  const pendingDictate = useRef(false);

  // the computer remembers whether Cleo was open and how wide, across refreshes
  useEffect(() => {
    const p = readPrefs();
    setMode(p.mode);
    if (p.open && !phoneLayoutNow()) {
      setOpen(true);
      setMounted(true);
    }
  }, []);
  useEffect(() => {
    if (!phone) writePrefs({ open, mode });
  }, [open, mode, phone]);
  useEffect(() => {
    const on = () => setVw(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  const getProfile = useServerFn(getSummerProfile);
  const { data: persona } = useQuery({
    queryKey: ["summer-profile"],
    queryFn: () => getProfile() as Promise<{ tone: string | null; instructions: string | null; isOwner: boolean; isFinance?: boolean }>,
    staleTime: 5 * 60_000,
  });
  const tone = summerTone(persona?.tone);
  const cleoActions = useCleoActions(open);

  // ---- speaking answers
  const speechFn = useServerFn(summerSpeech);
  const speaker = summerSpeaker();
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const serverVoice = useCallback<ServerVoice>((text, ctx) => speechFn({ data: { text, ...ctx } }) as Promise<any>, [speechFn]);
  const speak = useCallback(
    async (m: CleoMsg) => {
      if (speakingId === m.id) {
        speaker.stop();
        return;
      }
      speaker.unlock();
      setSpeakingId(m.id);
      try {
        await speaker.speak(m.content, loadVoicePrefs(), serverVoice);
      } finally {
        setSpeakingId((s) => (s === m.id ? null : s));
      }
    },
    [speaker, serverVoice, speakingId],
  );

  const openRef = useRef(open);
  openRef.current = open;
  const convo = useCleoConversation({
    enabled: mounted,
    routeClientId: place.clientId,
    routeBlockId: place.blockId,
    section: place.section,
    route: href,
    year,
    onAnswer: (msg, info) => {
      if (info.visible && openRef.current) {
        feedback("reply");
        if (info.dictated && loadVoicePrefs().autoplay) void speak(msg);
        return;
      }
      toast.message("Cleo answered", {
        description: msg.content.replace(/\s+/g, " ").slice(0, 120),
        action: { label: "Open", onClick: () => show({ chatId: info.chatId }) },
      });
    },
  });

  // ---- opening and closing
  const show = useCallback(
    (detail: SummerOpenDetail = {}) => {
      if (detail.year) setYear(detail.year);
      if (detail.chatId) convo.openConversation({ id: detail.chatId, client_id: detail.clientId ?? null });
      else if (detail.clientId) convo.openClient(detail.clientId);
      else if (detail.general) convo.useGeneral(true);
      if (detail.prompt) {
        const key = draftKey(convo.chatId, convo.client?.id ?? null);
        const cur = readDraft(userId, key);
        setDraft(cur.trim() ? `${cur.trim()}\n${detail.prompt}` : detail.prompt);
      }
      if (detail.dictate) {
        speaker.unlock();
        pendingDictate.current = true;
      }
      setMounted(true);
      setOpen(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [convo.openConversation, convo.openClient, convo.useGeneral, convo.chatId, convo.client?.id, userId, speaker],
  );
  const hide = useCallback(() => {
    setOpen(false);
    setShowHistory(false);
  }, []);

  useEffect(() => {
    if (open) {
      try {
        window.dispatchEvent(new Event(CLEO_PANEL_OPENED));
      } catch {
        // SSR
      }
    }
  }, [open]);

  const showRef = useRef(show);
  showRef.current = show;
  useEffect(() => {
    const onOpen = (e: Event) => showRef.current((e as CustomEvent<SummerOpenDetail>).detail ?? {});
    const onToggle = (e: Event) => {
      if (openRef.current) hide();
      else showRef.current((e as CustomEvent<SummerOpenDetail>).detail ?? {});
    };
    const onClose = () => hide();
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "S" || e.key === "s")) {
        e.preventDefault();
        if (openRef.current) hide();
        else showRef.current({});
      }
    };
    window.addEventListener("summer:open", onOpen);
    window.addEventListener("summer:toggle", onToggle);
    window.addEventListener("summer:close", onClose);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("summer:open", onOpen);
      window.removeEventListener("summer:toggle", onToggle);
      window.removeEventListener("summer:close", onClose);
      window.removeEventListener("keydown", onKey);
    };
  }, [hide]);

  // "/admin#cleo" (Cleo's approval and decision pushes) opens it
  useEffect(() => {
    if (hash !== "cleo" && hash !== "#cleo") return;
    showRef.current({});
    void qc.invalidateQueries({ queryKey: ["cleo-actions"] });
    try {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    } catch {
      // ignore
    }
  }, [hash, qc]);

  // the year from Taxes & Books applies while it's open from there
  useEffect(() => {
    if (!open) setYear(undefined);
  }, [open]);

  // Esc puts it away (a menu or dialog over it keeps its own Esc)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.("[data-cleo-panel]")) return;
      if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"]')) return;
      if (showHistory && !(mode === "expanded" && !phone)) return setShowHistory(false);
      hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, showHistory, mode, phone, hide]);

  // ---- the draft, kept per conversation on this device
  const dKey = draftKey(convo.chatId, convo.client?.id ?? null);
  const [draft, setDraftState] = useState("");
  const draftKeyRef = useRef(dKey);
  useEffect(() => {
    draftKeyRef.current = dKey;
    setDraftState(readDraft(userId, dKey));
  }, [dKey, userId]);
  const saveTimer = useRef(0);
  const setDraft = useCallback(
    (v: string) => {
      setDraftState(v);
      window.clearTimeout(saveTimer.current);
      const key = draftKeyRef.current;
      saveTimer.current = window.setTimeout(() => writeDraft(userId, key, v), 250);
    },
    [userId],
  );
  useEffect(() => {
    const flush = () => writeDraft(userId, draftKeyRef.current, draft);
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [userId, draft]);

  // ---- attachments
  const tray = useAttachmentTray();
  const fileRef = useRef<HTMLInputElement>(null);

  const transcribeFn = useServerFn(transcribeCleoDictation);
  const transcribe = useCallback((audio: string, mime: string) => transcribeFn({ data: { audio, mime } }) as Promise<{ ok: true; text: string } | { ok: false; reason: string }>, [transcribeFn]);

  // open straight into dictation (the mic on Cleo's row in Messages)
  useEffect(() => {
    if (!open || !pendingDictate.current) return;
    pendingDictate.current = false;
    const t = window.setTimeout(() => composer.current?.dictate(), 250);
    return () => window.clearTimeout(t);
  }, [open, convo.chatId]);

  const send = async (text: string, meta: { dictated: boolean }) => {
    if (tray.busy) {
      toast.message("Still uploading. Send again in a sec.");
      return false;
    }
    const atts = tray.ready;
    const key = dKey;
    setDraftState("");
    writeDraft(userId, key, "");
    const ok = await convo.send(text, { dictated: meta.dictated, attachments: atts });
    if (ok) {
      if (atts.length) tray.clear();
      return true;
    }
    // not sent: the words go back in the box (and on the device)
    setDraftState((cur) => (cur.trim() ? cur : text));
    writeDraft(userId, key, text);
    return false;
  };

  const openLink = useOpenLink(
    useCallback(() => {
      // on a phone Cleo covers the page, so it steps aside; on a computer it stays beside it
      if (phoneLayoutNow()) hide();
    }, [hide]),
  );

  // ---- the page makes room on a computer
  const expanded = mode === "expanded" && !phone;
  const width = expanded ? Math.max(PANEL_DOCKED_W, Math.min(980, vw - 360)) : Math.min(PANEL_DOCKED_W, vw);
  const pushes = !phone && open && vw - width >= PAGE_MIN_W;
  useEffect(() => {
    const root = document.documentElement;
    if (pushes) {
      root.setAttribute("data-cleo-panel", "");
      root.style.setProperty("--cleo-panel-w", `${width}px`);
    } else {
      root.removeAttribute("data-cleo-panel");
      root.style.removeProperty("--cleo-panel-w");
    }
  }, [pushes, width]);
  // open on a computer (pushing the page or over its edge): a page's right-hand floating button steps aside
  useEffect(() => {
    const root = document.documentElement;
    if (open && !phone) {
      root.setAttribute("data-cleo-open", "");
      root.style.setProperty("--cleo-open-w", `${width}px`);
    } else {
      root.removeAttribute("data-cleo-open");
      root.style.removeProperty("--cleo-open-w");
    }
  }, [open, phone, width]);
  useEffect(
    () => () => {
      const root = document.documentElement;
      root.removeAttribute("data-cleo-panel");
      root.removeAttribute("data-cleo-open");
      root.style.removeProperty("--cleo-panel-w");
      root.style.removeProperty("--cleo-open-w");
    },
    [],
  );

  const box = useVisualViewportBox(phone && open);

  // Drawn at the end of the page, so a page's own floating buttons never sit on top of it, while a
  // menu or dialog opened from inside it (added after it) still does. Moved back to the end whenever it
  // opens or the page changes (a new page's buttons are added after it).
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.createElement("div");
    el.setAttribute("data-cleo-host", "");
    document.body.appendChild(el);
    setHost(el);
    return () => el.remove();
  }, []);
  useLayoutEffect(() => {
    if (!open || !host || !host.nextSibling) return;
    // never while something inside it has focus (moving it would drop the focus)
    if (host.contains(document.activeElement)) return;
    document.body.appendChild(host);
  }, [open, pathname, host]);
  const sidebar = expanded && vw >= 1000;

  const [settingDays, setSettingDays] = useState<number | null>(null);
  const archiveFn = useServerFn(getCleoArchiveSetting);
  const saveArchiveFn = useServerFn(saveCleoArchiveSetting);
  const { data: archiveDays } = useQuery({ queryKey: ["cleo-archive-days"], queryFn: () => archiveFn() as Promise<{ days: number }>, enabled: mounted, staleTime: 10 * 60_000 });
  const setArchiveDays = async (days: number) => {
    setSettingDays(days);
    try {
      await saveArchiveFn({ data: { days } });
      qc.setQueryData(["cleo-archive-days"], { days });
      toast.success(days ? `Quiet conversations are archived after ${days} days.` : "Conversations won't be archived on their own.");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save that.");
    } finally {
      setSettingDays(null);
    }
  };

  if (!mounted || !host) return null;

  const client = convo.client;
  const first = client?.name?.split(/\s+/)[0] ?? null;
  const starters = client && first ? clientStarters(first, place.section) : persona?.isOwner ? OWNER_STARTERS : persona?.isFinance ? FINANCE_STARTERS : TEAM_STARTERS;
  const pageHasClient = !!(place.clientId || place.blockId);

  const contextChip = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 min-w-0 max-w-[13rem] cursor-pointer items-center gap-1 rounded-full bg-muted px-2.5 text-[12px] font-medium text-foreground hover:bg-secondary"
          aria-label={client ? `Conversation about ${client.name}. Change` : "General conversation. Change"}
          data-cleo-context
        >
          {client ? <User className="h-3 w-3 shrink-0" /> : <Users className="h-3 w-3 shrink-0" />}
          <span className="truncate">{client ? client.name : "General"}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
          {client ? `Everything here is about ${client.name}. Their records never mix with anyone else's.` : "A conversation about nobody in particular."}
        </DropdownMenuLabel>
        {pageHasClient && (
          <DropdownMenuItem onSelect={() => convo.useGeneral(false)}>
            <User className="mr-2 h-4 w-4" /> This page's client
            {convo.following && !convo.isGeneral && <Check className="ml-auto h-4 w-4" />}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => convo.useGeneral(true)}>
          <Users className="mr-2 h-4 w-4" /> General conversation
          {convo.isGeneral && <Check className="ml-auto h-4 w-4" />}
        </DropdownMenuItem>
        {client && !(convo.following && pageHasClient) && (
          <DropdownMenuItem disabled>
            <User className="mr-2 h-4 w-4" /> {client.name}
            <Check className="ml-auto h-4 w-4" />
          </DropdownMenuItem>
        )}
        {place.section && <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">You're in: {SECTION_LABEL[place.section]}</DropdownMenuLabel>}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const historyList = (
    <CleoHistory
      activeChatId={convo.chatId}
      onOpen={(c: CleoChat) => {
        convo.openConversation(c);
        if (!sidebar) setShowHistory(false);
      }}
      onNew={() => {
        convo.newConversation();
        if (!sidebar) setShowHistory(false);
        window.setTimeout(() => composer.current?.focus(), 50);
      }}
      onClose={sidebar ? undefined : () => setShowHistory(false)}
      onDeleted={(id) => convo.forget(id)}
      className={sidebar ? "w-64 shrink-0 border-r border-border" : "absolute inset-0 z-20 bg-background"}
    />
  );

  const empty = (
    <div className="mx-auto max-w-md space-y-4 pt-6 text-center">
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-foreground text-background">
        <CleoMark size={22} />
      </span>
      <div className="space-y-1">
        <p className="text-[15px] font-medium">{client ? `What do you need for ${first}?` : tone.greeting}</p>
        <p className="text-[12px] text-muted-foreground">Cleo remembers this conversation and changes nothing until you tap Confirm.</p>
      </div>
      <div className="flex flex-col gap-1.5 text-left">
        {starters.map((s) => (
          <button key={s} type="button" onClick={() => void send(s, { dictated: false })} className="min-h-10 cursor-pointer rounded-xl border border-border px-3 py-2 text-sm hover:bg-muted">
            {s}
          </button>
        ))}
      </div>
    </div>
  );

  const panelStyle = phone
    ? box?.keyboard
      ? { top: box.top, height: box.height, bottom: "auto" as const }
      : undefined
    : { width };

  return createPortal(
    <aside
      role="complementary"
      aria-label="Cleo"
      hidden={!open}
      data-cleo-panel={phone ? "phone" : expanded ? "expanded" : "docked"}
      className={cn(
        "fixed z-50 flex flex-col bg-background text-foreground",
        phone ? "phone-column inset-0" : "bottom-0 right-0 top-0 border-l border-border",
        !phone && !pushes && "shadow-[-16px_0_40px_-24px_rgba(0,0,0,0.45)]",
      )}
      style={panelStyle}
    >
      <header
        className={cn("flex shrink-0 items-center gap-1 border-b border-border px-2 pb-2", phone ? "pt-[calc(env(safe-area-inset-top)+0.5rem)]" : "pt-[calc(env(safe-area-inset-top)+0.5rem)]")}
        data-cleo-header
      >
        {!sidebar && (
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            aria-pressed={showHistory}
            className={cn("grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-lg hover:bg-muted", showHistory ? "text-foreground" : "text-muted-foreground")}
            aria-label="Conversations"
            title="Conversations"
            data-cleo-history-toggle
          >
            <Menu className="h-[18px] w-[18px]" />
          </button>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2 pl-1">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-foreground text-background" aria-hidden>
            <CleoMark size={16} />
          </span>
          <p className="shrink-0 text-sm font-semibold leading-tight" title={convo.chat?.title && convo.messages.length ? convo.chat.title : undefined}>
            Cleo <span className="sr-only">{CLEO_ROLE_LINE}</span>
          </p>
          <span className="min-w-0 shrink">{contextChip}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            convo.newConversation();
            setShowHistory(false);
            window.setTimeout(() => composer.current?.focus(), 50);
          }}
          className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="New conversation"
          title="New conversation"
          data-cleo-new-header
        >
          <SquarePen className="h-[18px] w-[18px]" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="More">
              <MoreHorizontal className="h-[18px] w-[18px]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onSelect={() => setCustomizing(true)}>
              <SlidersHorizontal className="mr-2 h-4 w-4" /> Customize Cleo
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                Archive quiet conversations
                <span className="ml-auto pl-2 text-[11px] text-muted-foreground">{archiveDays ? (archiveDays.days ? `${archiveDays.days} days` : "Never") : ""}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52">
                <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">Pinned ones and anything waiting on you are never archived. Archived is never deleted.</DropdownMenuLabel>
                {ARCHIVE_DAY_CHOICES.map((d) => (
                  <DropdownMenuItem key={d} disabled={settingDays !== null} onSelect={() => void setArchiveDays(d)}>
                    {d ? `After ${d} days` : "Never"}
                    {archiveDays?.days === d && <Check className="ml-auto h-4 w-4" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">⌘⇧S opens and closes Cleo</DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>
        {!phone && (
          <button
            type="button"
            onClick={() => setMode(expanded ? "docked" : "expanded")}
            className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={expanded ? "Make Cleo narrower" : "Make Cleo wider"}
            title={expanded ? "Narrower" : "Wider, with your conversations"}
            data-cleo-expand
          >
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        )}
        <button
          type="button"
          onClick={hide}
          className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close Cleo (keeps the conversation)"
          title="Close (keeps the conversation)"
          data-cleo-close
        >
          {phone ? <ChevronDown className="h-5 w-5" /> : <X className="h-[18px] w-[18px]" />}
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {sidebar && historyList}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {!sidebar && showHistory && historyList}
          {convo.loading ? (
            <div className="flex-1 space-y-4 px-4 py-6" aria-busy>
              {[0.6, 0.85, 0.45].map((w, i) => (
                <div key={i} className={cn("h-4 jf-skeleton rounded bg-muted", i % 2 ? "ml-auto" : "")} style={{ width: `${w * 100}%` }} />
              ))}
            </div>
          ) : convo.loadError ? (
            <div className="flex-1 px-4 py-8 text-sm text-muted-foreground">
              Couldn't load this conversation.{" "}
              <button type="button" onClick={() => void convo.retryLoad()} className="cursor-pointer font-medium text-foreground underline underline-offset-2">
                Try again
              </button>
            </div>
          ) : (
            <CleoThread
              messages={convo.messages}
              hasOlder={convo.hasOlder}
              loadOlder={convo.loadOlder}
              onLink={openLink}
              onRegenerate={(id) => void convo.regenerate(id)}
              onEdit={convo.editAndSend}
              onPick={(c) => void send(c, { dictated: false })}
              answering={convo.answering}
              actionsFor={cleoActions.forMessage}
              ownerName={cleoActions.data?.ownerName ?? "the owner"}
              speakingId={speakingId}
              onSpeak={(m) => void speak(m)}
              empty={empty}
              top={cleoActions.data?.approvals.length ? <div className="mb-4"><CleoApprovals approvals={cleoActions.data.approvals} ownerName={cleoActions.data.ownerName} onOpen={(h) => openLink(h, true)} /></div> : null}
            />
          )}
          <div className={cn("shrink-0 px-3 pt-2", phone && !box?.keyboard ? "pb-[max(0.75rem,env(safe-area-inset-bottom))]" : "pb-3")}>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ATTACH_ACCEPT}
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) tray.add(e.target.files);
                e.target.value = "";
              }}
            />
            <CleoComposer
              ref={composer}
              value={draft}
              onChange={setDraft}
              onSend={send}
              answering={convo.answering}
              onStop={() => void convo.stop()}
              canSendEmpty={tray.ready.length > 0}
              placeholder={client ? `Ask about ${first}, or anything…` : "Ask Cleo anything…"}
              transcribe={transcribe}
              onAttach={() => fileRef.current?.click()}
              onPasteFiles={(files) => tray.add(files)}
              above={tray.items.length ? <div className="mb-2"><AttachmentTray items={tray.items} onRemove={tray.remove} /></div> : null}
              autoFocus={open}
            />
          </div>
        </div>
      </div>
      <SummerCustomizeDialog
        open={customizing}
        onClose={() => setCustomizing(false)}
        persona={{ tone: persona?.tone, instructions: persona?.instructions }}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["summer-profile"] });
          qc.invalidateQueries({ queryKey: ["books-data"] });
        }}
      />
    </aside>,
    host,
  );
}
