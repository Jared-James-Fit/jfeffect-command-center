/**
 * Account view sessions on the server. Each call is a database function that checks the caller
 * (admin_pov_*: an admin for any client or member record, a coach for their own coaching
 * clients), run with the caller's own session.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PovServerState = {
  status: string;
  id?: string;
  client_id?: string;
  mode?: "view" | "edit";
  edit_until?: string | null;
  expires_at?: string;
  max_until?: string;
  ended_at?: string | null;
  end_reason?: string | null;
};

export const startPovSessionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ clientId: z.string().uuid(), reason: z.string().max(300), mode: z.enum(["view", "edit"]).default("view") })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<PovServerState> => {
    const { data: out, error } = await (context.supabase as any).rpc("admin_pov_start", {
      _client_id: data.clientId,
      _reason: data.reason,
      _mode: data.mode,
    });
    if (error) throw new Error(error.code === "42501" ? "You can't open that account." : error.message);
    return out as PovServerState;
  });

export const setPovModeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ sessionId: z.string().uuid(), mode: z.enum(["view", "edit"]), reason: z.string().max(300).optional() }).parse(i),
  )
  .handler(async ({ data, context }): Promise<PovServerState> => {
    const { data: out, error } = await (context.supabase as any).rpc("admin_pov_set_mode", {
      _session: data.sessionId,
      _mode: data.mode,
      _reason: data.reason ?? null,
    });
    if (error) throw new Error(error.message);
    return out as PovServerState;
  });

const EventInput = z.object({
  kind: z.enum(["view", "write", "blocked"]),
  path: z.string().max(200).optional(),
  method: z.string().max(10).optional(),
  target: z.string().max(120).nullable().optional(),
  at: z.string().max(40),
});

export const touchPovFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ sessionId: z.string().uuid(), events: z.array(EventInput).max(60).default([]) }).parse(i),
  )
  .handler(async ({ data, context }): Promise<PovServerState> => {
    const { data: out, error } = await (context.supabase as any).rpc("admin_pov_touch", {
      _session: data.sessionId,
      _events: data.events,
    });
    if (error) throw new Error(error.message);
    return out as PovServerState;
  });

export const endPovFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ sessionId: z.string().uuid(), why: z.string().max(40).optional() }).parse(i))
  .handler(async ({ data, context }): Promise<PovServerState> => {
    const { data: out, error } = await (context.supabase as any).rpc("admin_pov_end", {
      _session: data.sessionId,
      _why: data.why ?? "exit",
    });
    if (error) throw new Error(error.message);
    return out as PovServerState;
  });

export type PovLogEntry = {
  id: string;
  staff_user_id: string;
  staff_name: string;
  reason: string;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
  edited: boolean;
  views: number;
  writes: number;
  events: Array<{ at: string; kind: string; detail: Record<string, string> }>;
};

export const povLogFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ clientId: z.string().uuid(), limit: z.number().int().min(1).max(100).default(20) }).parse(i))
  .handler(async ({ data, context }): Promise<PovLogEntry[]> => {
    const { data: out, error } = await (context.supabase as any).rpc("admin_pov_log", { _client_id: data.clientId, _limit: data.limit });
    if (error) throw new Error(error.message);
    return (out ?? []) as PovLogEntry[];
  });
