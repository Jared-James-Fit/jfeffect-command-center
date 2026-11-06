// Server-side reads for the public challenge pages (the first paint and the
// link previews: iMessage, Instagram, WhatsApp). Signed out, through the same
// public database functions the browser uses, so nothing private can leak.
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AthleteProfile, BoardData, ChallengePageData, HubCard, ResultData } from "./types";

function anon() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const slug = z.string().min(1).max(80).regex(/^[a-z0-9-]+$/i);

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (anon() as any).rpc(fn, args);
    if (error) return null;
    return (data ?? null) as T | null;
  } catch {
    return null;
  }
}

export const getHubFn = createServerFn({ method: "GET" }).handler(async () => (await call<HubCard[]>("challenge_hub")) ?? []);

export const getChallengeFn = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => z.object({ slug }).parse(d))
  .handler(async ({ data }) => {
    const [page, board] = await Promise.all([
      call<ChallengePageData>("challenge_page", { p_slug: data.slug.toLowerCase() }),
      call<BoardData>("challenge_board", { p_slug: data.slug.toLowerCase() }),
    ]);
    return { page, board };
  });

export const getResultFn = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string; handle: string }) => z.object({ slug, handle: slug }).parse(d))
  .handler(async ({ data }) => call<ResultData>("challenge_result", { p_slug: data.slug.toLowerCase(), p_handle: data.handle.toLowerCase() }));

export const getAthleteFn = createServerFn({ method: "GET" })
  .inputValidator((d: { handle: string }) => z.object({ handle: slug }).parse(d))
  .handler(async ({ data }) => call<AthleteProfile>("challenge_athlete", { p_handle: data.handle.toLowerCase() }));
