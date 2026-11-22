/**
 * Cleo's access settings (Admin → Settings → AI & Cleo) and whether the
 * signed-in person may use Cleo. Every answer comes from the database's
 * `cleo_allowed()` / `cleo_access_*` functions with the caller's own login, so
 * the screens and the server can never disagree.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const NOT_YET = "Who has Cleo needs today's database update. Until it runs, the admin and the finance login have Cleo and coaches don't.";
const isMissing = (e: any) => e?.code === "PGRST202" || e?.code === "42883" || /could not find the function|function .* does not exist/i.test(e?.message ?? "");

export type CleoAccessSettings = { coach: boolean; finance: boolean };

function settingsOf(raw: any): CleoAccessSettings {
  return { coach: raw?.coach === true, finance: raw?.finance !== false };
}

/** May I use Cleo? False for anyone it isn't switched on for (clients and members always). */
export const getCleoAccessFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { cleoAllowed } = await import("@/lib/cleo-access.server");
    const { allowed } = await cleoAllowed(context as any);
    return { allowed };
  });

/** Admin only: who has Cleo now. */
export const getCleoAccessSettingsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context as any).supabase.rpc("cleo_access_get");
    if (error) throw new Error(isMissing(error) ? NOT_YET : error.message);
    return settingsOf(data);
  });

/** Admin only: switch Cleo on or off for coaches and the finance login. */
export const setCleoAccessFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ coach: z.boolean(), finance: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: saved, error } = await (context as any).supabase.rpc("cleo_access_set", { _coach: data.coach, _finance: data.finance });
    if (error) throw new Error(isMissing(error) ? NOT_YET : error.message);
    return settingsOf(saved);
  });
