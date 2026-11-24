/**
 * The state behind Cleo's panel (Nov 24 2026): which conversation is on
 * screen for where the coach is, its messages (paged back as they scroll),
 * sending (shown at once, never twice), the answers being written in the
 * background (followed until they land, wherever the coach has gone since),
 * stop, edit & resend and regenerate.
 *
 * Where the coach is decides the conversation: a client's page opens that
 * client's most recent conversation, anywhere else the general one. Moving
 * between a client's sections keeps the same conversation; moving to another
 * client restores theirs. The coach can switch a client's page to the general
 * conversation (and back), open any conversation from History, or start a new one.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  loadOlderCleoMessages,
  openCleoConversation,
  pollCleoTurns,
  startCleoTurn,
  stopCleoTurn,
} from "@/lib/cleo-conversations.functions";
import { chatTitle, type CleoChat, type CleoSection } from "@/lib/cleo-chats";
import type { CleoAttachment } from "@/lib/cleo-attachments";

export type CleoMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  choices?: string[] | null;
  chat_id?: string | null;
  attachments?: CleoAttachment[] | null;
  status?: "pending" | "running" | "done" | "failed" | "stopped";
  progress?: string | null;
  error?: string | null;
  reply_to?: string | null;
  updated_at?: string | null;
  /** Not saved yet (shown the moment it's sent). */
  local?: boolean;
};

export type ConvData = { chat: CleoChat | null; messages: CleoMsg[]; hasOlder: boolean; client: { id: string; name: string } | null };

export const convKey = (chatId: string) => ["cleo-conv", chatId] as const;
export const placeKey = (clientId: string | null) => ["cleo-conv-place", clientId ?? "general"] as const;
export const HISTORY_KEY = ["cleo-history"] as const;

const OPEN = new Set(["pending", "running"]);
export const isOpenTurn = (m: Pick<CleoMsg, "role" | "status">) => m.role === "assistant" && OPEN.has(m.status ?? "done");

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** "general", or the client's id: one remembered conversation per place. */
const ctxOf = (clientId: string | null | undefined) => clientId ?? "general";

type Outgoing = { key: string; ctx: string; chatId: string | null; user: CleoMsg | null; assistant: CleoMsg; dictated: boolean };

export function useCleoConversation(opts: {
  enabled: boolean;
  /** The client the page is about (null: none). */
  routeClientId: string | null;
  /** The block editor's block (its client is looked up). */
  routeBlockId?: string | null;
  section: CleoSection | null;
  route: string;
  year?: number;
  /** An answer landed: whether the coach can see it (else a toast). */
  onAnswer?: (msg: CleoMsg, info: { visible: boolean; dictated: boolean; chatId: string }) => void;
}) {
  const qc = useQueryClient();
  const openFn = useServerFn(openCleoConversation);
  const olderFn = useServerFn(loadOlderCleoMessages);
  const startFn = useServerFn(startCleoTurn);
  const pollFn = useServerFn(pollCleoTurns);
  const stopFn = useServerFn(stopCleoTurn);

  // Which place the conversation is for: the page's client, or one the coach picked.
  const [picked, setPicked] = useState<string | null>(null); // a ctx, or null = follow the page
  const routeCtx = opts.routeBlockId && !opts.routeClientId ? `block:${opts.routeBlockId}` : ctxOf(opts.routeClientId);
  const lastRoute = useRef(routeCtx);
  useEffect(() => {
    // another client (or none): follow the page again
    if (lastRoute.current !== routeCtx) {
      lastRoute.current = routeCtx;
      setPicked(null);
    }
  }, [routeCtx]);
  const ctx = picked ?? routeCtx;

  // The conversation shown for each place this visit ("new": a fresh one).
  const [selection, setSelection] = useState<Record<string, string>>({});
  const sel = selection[ctx];
  const select = useCallback((c: string, value: string | null) => setSelection((s) => {
    const next = { ...s };
    if (value) next[c] = value;
    else delete next[c];
    return next;
  }), []);

  const placeClient = ctx === "general" ? null : ctx.startsWith("block:") ? null : ctx;
  const placeBlock = ctx.startsWith("block:") ? ctx.slice(6) : null;

  // The place's own conversation (its latest active one), and who it's about.
  const place = useQuery({
    queryKey: [...placeKey(placeClient), placeBlock ?? ""],
    queryFn: () => openFn({ data: { clientId: placeClient, blockId: placeBlock } }) as Promise<ConvData>,
    enabled: opts.enabled && (!sel || sel === "new"),
    staleTime: 30_000,
  });
  // the place's conversation becomes the one shown (and its own cache entry)
  useEffect(() => {
    if (sel || !place.data) return;
    const chat = place.data.chat;
    if (chat) {
      qc.setQueryData(convKey(chat.id), place.data);
      select(ctx, chat.id);
    }
  }, [place.data, sel, ctx, qc, select]);

  const chatId = sel && sel !== "new" ? sel : null;
  const conv = useQuery({
    queryKey: chatId ? convKey(chatId) : ["cleo-conv", "none"],
    queryFn: () => openFn({ data: { chatId } }) as Promise<ConvData>,
    enabled: opts.enabled && !!chatId,
    staleTime: 30_000,
  });

  const placeClientInfo = place.data?.client ?? null;
  const data: ConvData | null = chatId ? conv.data ?? null : sel === "new" || (place.data && !place.data.chat) ? { chat: null, messages: [], hasOlder: false, client: placeClientInfo } : null;
  const loading = chatId ? conv.isLoading : !sel ? place.isLoading : false;
  const loadError = (chatId ? conv.error : !sel ? place.error : null) as Error | null;

  // sending, shown at once
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const mine = outgoing.filter((o) => o.ctx === ctx && o.chatId === (chatId ?? null));
  const messages: CleoMsg[] = useMemo(() => {
    const base = data?.messages ?? [];
    const extra = mine.flatMap((o) => [...(o.user ? [o.user] : []), o.assistant]);
    return [...base, ...extra];
  }, [data?.messages, mine]);
  const answering = messages.some(isOpenTurn);

  // ---- the answers being written, followed wherever the coach goes
  const watch = useRef(new Map<string, { chatId: string; dictated: boolean; since: number }>());
  const [watchTick, setWatchTick] = useState(0);
  const follow = useCallback((id: string, chat: string, dictated = false) => {
    if (watch.current.has(id)) return;
    watch.current.set(id, { chatId: chat, dictated, since: Date.now() });
    setWatchTick((n) => n + 1);
  }, []);
  // answers already in progress when a conversation opens (after a refresh, on another device)
  useEffect(() => {
    if (!chatId || !data) return;
    for (const m of data.messages) if (isOpenTurn(m) && !m.local) follow(m.id, chatId);
  }, [chatId, data, follow]);

  /** The conversation's name and topic (named after its first answer), without reloading its messages. */
  const refreshMeta = useCallback(
    async (chat: string) => {
      try {
        const fresh = (await openFn({ data: { chatId: chat } })) as ConvData;
        qc.setQueryData<ConvData>(convKey(chat), (old) => (old && fresh.chat ? { ...old, chat: { ...old.chat, ...fresh.chat } } : old));
      } catch {
        // the name can wait
      }
    },
    [openFn, qc],
  );

  const shownRef = useRef<string | null>(null);
  shownRef.current = chatId;
  const onAnswerRef = useRef(opts.onAnswer);
  onAnswerRef.current = opts.onAnswer;

  const patchMessage = useCallback(
    (chat: string, row: CleoMsg) => {
      qc.setQueryData<ConvData>(convKey(chat), (old) =>
        old ? { ...old, messages: old.messages.map((m) => (m.id === row.id ? { ...m, ...row, local: false } : m)) } : old,
      );
    },
    [qc],
  );

  useEffect(() => {
    if (!watch.current.size) return;
    let stop = false;
    let timer = 0;
    const tick = async () => {
      if (stop || !watch.current.size) return;
      const ids = [...watch.current.keys()].slice(0, 20);
      try {
        const rows = (await pollFn({ data: { ids } })) as CleoMsg[];
        const seen = new Set<string>();
        for (const row of rows) {
          seen.add(row.id);
          const w = watch.current.get(row.id);
          if (!w) continue;
          patchMessage(w.chatId, row);
          if (!OPEN.has(row.status ?? "done")) {
            watch.current.delete(row.id);
            if (row.status === "done") {
              onAnswerRef.current?.(row, { visible: shownRef.current === w.chatId, dictated: w.dictated, chatId: w.chatId });
              // cards it set up, the history's preview, and the conversation's new name a moment later
              void qc.invalidateQueries({ queryKey: ["cleo-actions"] });
              void qc.invalidateQueries({ queryKey: HISTORY_KEY });
              window.setTimeout(() => void refreshMeta(w.chatId), 5_000);
            }
          }
        }
        // gone (deleted elsewhere): stop following
        for (const id of ids) if (!seen.has(id)) watch.current.delete(id);
      } catch {
        // offline or a blip: the next tick
      }
      if (stop || !watch.current.size) return;
      const youngest = Math.min(...[...watch.current.values()].map((w) => Date.now() - w.since));
      timer = window.setTimeout(tick, youngest < 15_000 ? 1_000 : document.hidden ? 6_000 : 2_000);
    };
    timer = window.setTimeout(tick, 700);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [watchTick, pollFn, patchMessage, qc, refreshMeta]);

  // ---- asking
  const lastFailed = useRef<{ text: string; key: string } | null>(null);

  const put = useCallback(
    (res: { chatId: string; user: CleoMsg | null; assistant: CleoMsg }, firstText: string, client: ConvData["client"]) => {
      qc.setQueryData<ConvData>(convKey(res.chatId), (old) => {
        const rows = [...(res.user ? [res.user] : []), res.assistant];
        if (!old) {
          const now = res.assistant.created_at;
          return {
            chat: { id: res.chatId, title: chatTitle(firstText), preview: null, created_at: now, last_message_at: now, client_id: client?.id ?? null, client_name: client?.name ?? null },
            messages: rows,
            hasOlder: false,
            client,
          };
        }
        const ids = new Set(old.messages.map((m) => m.id));
        return { ...old, messages: [...old.messages, ...rows.filter((r) => !ids.has(r.id))] };
      });
    },
    [qc],
  );

  const send = useCallback(
    async (text: string, meta: { dictated?: boolean; attachments?: CleoAttachment[] } = {}): Promise<boolean> => {
      const message = text.trim();
      const atts = meta.attachments ?? [];
      if (!message && !atts.length) return false;
      if (answering) {
        toast.message("Cleo is still answering. Tap Stop first, or wait for it.");
        return false;
      }
      const key = lastFailed.current && lastFailed.current.text === message ? lastFailed.current.key : newKey();
      const now = new Date();
      const thisCtx = ctx;
      const thisChat = chatId;
      const out: Outgoing = {
        key,
        ctx: thisCtx,
        chatId: thisChat,
        dictated: !!meta.dictated,
        user: { id: `local-u-${key}`, role: "user", content: message, created_at: now.toISOString(), status: "done", attachments: atts.length ? atts : null, local: true },
        assistant: { id: `local-a-${key}`, role: "assistant", content: "", created_at: new Date(now.getTime() + 1).toISOString(), status: "pending", progress: "Sending…", local: true },
      };
      setOutgoing((o) => [...o, out]);
      try {
        const res = (await startFn({
          data: {
            key,
            message,
            chatId: thisChat,
            ...(atts.length ? { attachments: atts } : {}),
            route: opts.route.slice(0, 300),
            ...(opts.year ? { year: opts.year } : {}),
            clientId: thisChat ? null : placeClient ?? placeClientInfo?.id ?? null,
            section: opts.section,
          },
        })) as { chatId: string; user: CleoMsg | null; assistant: CleoMsg };
        lastFailed.current = null;
        put(res, message, data?.client ?? placeClientInfo);
        if (!thisChat) select(thisCtx, res.chatId);
        if (isOpenTurn(res.assistant)) follow(res.assistant.id, res.chatId, !!meta.dictated);
        else if (res.assistant.status === "done") onAnswerRef.current?.(res.assistant, { visible: true, dictated: !!meta.dictated, chatId: res.chatId });
        void qc.invalidateQueries({ queryKey: HISTORY_KEY });
        return true;
      } catch (e: any) {
        lastFailed.current = { text: message, key };
        toast.error(e?.message?.includes("fetch") || !navigator.onLine ? "Not sent: no connection. Your message is still in the box." : e?.message ?? "Couldn't send that.");
        return false;
      } finally {
        setOutgoing((o) => o.filter((x) => x.key !== key));
      }
    },
    [answering, ctx, chatId, startFn, opts.route, opts.year, opts.section, placeClient, put, data?.client, placeClientInfo, select, follow, qc],
  );

  /** Replace the answer (or the stopped / failed one) with a fresh one to the same question. */
  const regenerate = useCallback(
    async (assistantId: string) => {
      if (!chatId || answering) return;
      const key = newKey();
      const before = qc.getQueryData<ConvData>(convKey(chatId));
      const target = before?.messages.find((m) => m.id === assistantId);
      if (!target) return;
      qc.setQueryData<ConvData>(convKey(chatId), (old) =>
        old ? { ...old, messages: old.messages.filter((m) => m.created_at < target.created_at) } : old,
      );
      const placeholderMsg: Outgoing = {
        key,
        ctx,
        chatId,
        dictated: false,
        user: null,
        assistant: { id: `local-a-${key}`, role: "assistant", content: "", created_at: new Date().toISOString(), status: "pending", progress: "Starting again…", local: true },
      };
      setOutgoing((o) => [...o, placeholderMsg]);
      try {
        const res = (await startFn({ data: { key, message: "", chatId, regenerate: assistantId, route: opts.route.slice(0, 300), section: opts.section } })) as { chatId: string; user: CleoMsg | null; assistant: CleoMsg };
        put(res, "", data?.client ?? null);
        if (isOpenTurn(res.assistant)) follow(res.assistant.id, res.chatId);
      } catch (e: any) {
        if (before) qc.setQueryData(convKey(chatId), before);
        toast.error(e?.message ?? "Couldn't try again.");
      } finally {
        setOutgoing((o) => o.filter((x) => x.key !== key));
      }
    },
    [chatId, answering, qc, ctx, startFn, opts.route, opts.section, put, data?.client, follow],
  );

  /** Edit a question and send it again: it and everything after it step aside (kept, not shown). */
  const editAndSend = useCallback(
    async (userMsgId: string, text: string): Promise<boolean> => {
      const message = text.trim();
      if (!chatId || !message || answering) return false;
      const key = newKey();
      const before = qc.getQueryData<ConvData>(convKey(chatId));
      const target = before?.messages.find((m) => m.id === userMsgId);
      if (!target) return false;
      qc.setQueryData<ConvData>(convKey(chatId), (old) => (old ? { ...old, messages: old.messages.filter((m) => m.created_at < target.created_at) } : old));
      const now = new Date();
      const out: Outgoing = {
        key,
        ctx,
        chatId,
        dictated: false,
        user: { id: `local-u-${key}`, role: "user", content: message, created_at: now.toISOString(), status: "done", local: true },
        assistant: { id: `local-a-${key}`, role: "assistant", content: "", created_at: new Date(now.getTime() + 1).toISOString(), status: "pending", progress: "Sending…", local: true },
      };
      setOutgoing((o) => [...o, out]);
      try {
        const res = (await startFn({ data: { key, message, chatId, edit: userMsgId, route: opts.route.slice(0, 300), section: opts.section } })) as { chatId: string; user: CleoMsg | null; assistant: CleoMsg };
        put(res, message, data?.client ?? null);
        if (isOpenTurn(res.assistant)) follow(res.assistant.id, res.chatId);
        return true;
      } catch (e: any) {
        if (before) qc.setQueryData(convKey(chatId), before);
        toast.error(e?.message ?? "Couldn't send that.");
        return false;
      } finally {
        setOutgoing((o) => o.filter((x) => x.key !== key));
      }
    },
    [chatId, answering, qc, ctx, startFn, opts.route, opts.section, put, data?.client, follow],
  );

  const stop = useCallback(async () => {
    const open = messages.filter(isOpenTurn);
    if (!open.length) return;
    for (const m of open) {
      if (m.local) continue;
      const chat = m.chat_id ?? chatId;
      if (chat) patchMessage(chat, { ...m, status: "stopped", progress: null });
      try {
        await stopFn({ data: { id: m.id } });
      } catch {
        // the poll shows how it really ended
      }
    }
  }, [messages, chatId, patchMessage, stopFn]);

  const loadOlder = useCallback(async () => {
    if (!chatId || !data?.hasOlder || !data.messages.length) return;
    const first = data.messages[0];
    const res = (await olderFn({ data: { chatId, before: first.created_at } })) as { messages: CleoMsg[]; hasOlder: boolean };
    qc.setQueryData<ConvData>(convKey(chatId), (old) => {
      if (!old) return old;
      const ids = new Set(old.messages.map((m) => m.id));
      return { ...old, hasOlder: res.hasOlder, messages: [...res.messages.filter((m) => !ids.has(m.id)), ...old.messages] };
    });
  }, [chatId, data, olderFn, qc]);

  /** A fresh conversation for this place (the current one stays in History). */
  const newConversation = useCallback(() => select(ctx, "new"), [ctx, select]);

  /** Open one from History (its own place: its client's, or the general one). */
  const openConversation = useCallback(
    (chat: Pick<CleoChat, "id" | "client_id">) => {
      const c = ctxOf(chat.client_id);
      if (c !== routeCtx) setPicked(c);
      else setPicked(null);
      select(c, chat.id);
    },
    [routeCtx, select],
  );

  /** A client's conversation, wherever the coach is (a dock's Conversation). */
  const openClient = useCallback((clientId: string) => setPicked(ctxOf(clientId) === routeCtx ? null : ctxOf(clientId)), [routeCtx]);

  /** Talk about nobody in particular here (or go back to the page's client). */
  const useGeneral = useCallback((general: boolean) => setPicked(general ? "general" : null), []);

  /** A conversation was deleted: let it go wherever it was shown. */
  const forget = useCallback(
    (id: string) => {
      setSelection((s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== id)));
      qc.removeQueries({ queryKey: convKey(id) });
      void qc.invalidateQueries({ queryKey: ["cleo-conv-place"] });
    },
    [qc],
  );

  return {
    ctx,
    routeCtx,
    following: picked === null,
    isGeneral: ctx === "general",
    chat: data?.chat ?? null,
    chatId,
    client: data?.client ?? null,
    messages,
    hasOlder: !!data?.hasOlder,
    loading,
    loadError,
    retryLoad: () => (chatId ? conv.refetch() : place.refetch()),
    answering,
    send,
    stop,
    regenerate,
    editAndSend,
    loadOlder,
    newConversation,
    openConversation,
    openClient,
    useGeneral,
    forget,
  };
}

export type CleoConversation = ReturnType<typeof useCleoConversation>;
