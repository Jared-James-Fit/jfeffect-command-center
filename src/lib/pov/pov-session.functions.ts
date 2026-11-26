/**
 * Account view sessions on the server. Each call is a database function that checks the caller
 * (admin_pov_*: an admin for any client or member record, a coach only for their own assigned
 * clients; a refusal is on the access record), run with the caller's own session. The access
 * record itself (admin_access_log / admin_access_session) is the admin's alone.
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
      .object({ clientId: z.string().uuid(), mode: z.enum(["view", "edit"]).default("view") })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<PovServerState> => {
    const { data: out, error } = await (context.supabase as any).rpc("admin_pov_start", {
      _client_id: data.clientId,
      _reason: null,
      _mode: data.mode,
    });
    if (error) throw new Error(error.code === "42501" ? "You can't open that account." : error.message);
    return out as PovServerState;
  });

export const setPovModeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ sessionId: z.string().uuid(), mode: z.enum(["view", "edit"]) }).parse(i),
  )
  .handler(async ({ data, context }): Promise<PovServerState> => {
    const { data: out, error } = await (context.supabase as any).rpc("admin_pov_set_mode", {
      _session: data.sessionId,
      _mode: data.mode,
      _reason: null,
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

export type AccessLogRow = {
  type: "session" | "denied";
  id: string;
  at: string;
  staff_user_id: string;
  staff_name: string | null;
  staff_role: string | null;
  client_id: string | null;
  client_name: string | null;
  status: "active" | "completed" | "expired" | "interrupted" | "revoked" | "denied";
  // a session
  reason?: string | null;
  started_at?: string;
  ended_at?: string | null;
  end_reason?: string | null;
  last_seen_at?: string | null;
  mode?: "view" | "edit";
  seconds?: number;
  views?: number;
  changes?: number;
  blocked?: number;
  edited?: boolean;
  // a refusal
  source?: string;
  detail?: Record<string, any>;
};

export type AccessLogPage = { total: number; rows: AccessLogRow[]; staff: Array<{ id: string; name: string }> };

export const ACCESS_KINDS = ["all", "sessions", "edits", "changes", "blocked", "denied", "active", "interrupted", "expired", "revoked"] as const;
export type AccessKind = (typeof ACCESS_KINDS)[number];

/** The access record, filtered: an admin only (the database refuses anyone else). */
export const accessLogFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        staffUserId: z.string().uuid().nullable().optional(),
        clientId: z.string().uuid().nullable().optional(),
        from: z.string().datetime({ offset: true }).nullable().optional(),
        to: z.string().datetime({ offset: true }).nullable().optional(),
        kind: z.enum(ACCESS_KINDS).default("all"),
        search: z.string().max(120).nullable().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).max(100_000).default(0),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<AccessLogPage> => {
    const { data: out, error } = await (context.supabase as any).rpc("admin_access_log", {
      _staff_user_id: data.staffUserId ?? null,
      _client_id: data.clientId ?? null,
      _from: data.from ?? null,
      _to: data.to ?? null,
      _kind: data.kind,
      _search: data.search?.trim() || null,
      _limit: data.limit,
      _offset: data.offset,
    });
    if (error) throw new Error(error.code === "42501" ? "Only the admin can read the access record." : error.message);
    return (out ?? { total: 0, rows: [], staff: [] }) as AccessLogPage;
  });

export type AccessEvent = { at: string; kind: string; detail: Record<string, any> };

/** Everything that happened in one account view, in order: an admin only. */
export const accessSessionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ sessionId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<AccessEvent[]> => {
    const { data: out, error } = await (context.supabase as any).rpc("admin_access_session", { _session: data.sessionId });
    if (error) throw new Error(error.code === "42501" ? "Only the admin can read the access record." : error.message);
    return (out ?? []) as AccessEvent[];
  });

/** One account's access history (the client profile): an admin only. */
export const povLogFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ clientId: z.string().uuid(), limit: z.number().int().min(1).max(100).default(20) }).parse(i))
  .handler(async ({ data, context }): Promise<AccessLogPage> => {
    const { data: out, error } = await (context.supabase as any).rpc("admin_pov_log", { _client_id: data.clientId, _limit: data.limit });
    if (error) throw new Error(error.code === "42501" ? "Only the admin can read the access record." : error.message);
    return (out ?? { total: 0, rows: [], staff: [] }) as AccessLogPage;
  });
