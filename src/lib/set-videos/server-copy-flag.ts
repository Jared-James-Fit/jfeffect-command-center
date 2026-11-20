/**
 * Whether the server makes set videos' 720p copies for Crew (set_video_server_copies,
 * app_settings 'feed_copies', written by the feed-copies hook once it runs with the
 * video service's keys). Read once an app open, again after a while; anything
 * unreadable counts as off, so the phone keeps making copies itself.
 */
import { supabase } from "@/integrations/supabase/client";

const FRESH_MS = 10 * 60_000;
let cached: { on: boolean; at: number } | null = null;
let pending: Promise<boolean> | null = null;

export function serverCopiesOn(): Promise<boolean> {
  if (cached && Date.now() - cached.at < FRESH_MS) return Promise.resolve(cached.on);
  if (pending) return pending;
  pending = (async () => {
    try {
      const { data, error } = await (supabase as any).rpc("set_video_server_copies");
      const on = !error && data === true;
      cached = { on, at: Date.now() };
      return on;
    } catch {
      return cached?.on ?? false;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/** The last answer without asking (null before the first). */
export function serverCopiesKnown(): boolean | null {
  return cached ? cached.on : null;
}
