/**
 * Keeps a tasks list in step with the database from any device.
 *
 * Supabase realtime is a websocket, and iOS silently kills it when the PWA is
 * backgrounded or the phone sleeps. The socket then looks open but delivers
 * nothing, so changes made on desktop never reach the phone. We therefore:
 *  - re-create the channel (and refetch) whenever the app becomes visible,
 *    comes back from the bfcache, or regains network;
 *  - re-create it after an error/timeout/close, with a short back-off;
 *  - refetch once every time a channel (re)subscribes, to cover any events
 *    missed while it was down.
 * Pure of React so it can be unit-tested with fakes.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";

type ChannelClient = {
  channel(name: string): RealtimeChannel;
  removeChannel(ch: RealtimeChannel): unknown;
};

export const RESUBSCRIBE_DELAY_MS = 2000;
/** Resume fires several events at once (focus, visibilitychange, pageshow). */
export const RESUME_DEBOUNCE_MS = 1000;

export function watchTasksRealtime(opts: {
  client: ChannelClient;
  name: string;
  table: string;
  filter: string;
  /** Called for every change event, and once after each (re)subscribe. */
  onChange: () => void;
  doc?: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  win?: Pick<Window, "addEventListener" | "removeEventListener" | "setTimeout" | "clearTimeout">;
}): () => void {
  const doc = opts.doc ?? (typeof document !== "undefined" ? document : undefined);
  const win = opts.win ?? (typeof window !== "undefined" ? window : undefined);
  let ch: RealtimeChannel | null = null;
  let retry: number | undefined;
  let disposed = false;
  let seq = 0;
  let lastConnect = -Infinity;

  const drop = () => {
    if (ch) { opts.client.removeChannel(ch); ch = null; }
  };

  const connect = () => {
    if (disposed) return;
    win?.clearTimeout(retry);
    drop();
    lastConnect = Date.now();
    const mine = ++seq;
    ch = opts.client
      .channel(`${opts.name}-${mine}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: opts.table, filter: opts.filter },
        () => opts.onChange(),
      )
      .subscribe((status) => {
        if (disposed || mine !== seq) return;
        if (status === "SUBSCRIBED") opts.onChange();
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          retry = win?.setTimeout(connect, RESUBSCRIBE_DELAY_MS);
        }
      });
  };

  const onResume = () => {
    if (doc && doc.visibilityState === "hidden") return;
    if (Date.now() - lastConnect < RESUME_DEBOUNCE_MS) return;
    connect();
  };

  connect();
  doc?.addEventListener("visibilitychange", onResume);
  win?.addEventListener("pageshow", onResume);
  win?.addEventListener("online", onResume);
  win?.addEventListener("focus", onResume);

  return () => {
    disposed = true;
    win?.clearTimeout(retry);
    doc?.removeEventListener("visibilitychange", onResume);
    win?.removeEventListener("pageshow", onResume);
    win?.removeEventListener("online", onResume);
    win?.removeEventListener("focus", onResume);
    drop();
  };
}
