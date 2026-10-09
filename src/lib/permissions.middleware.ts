/**
 * requirePermission(perm): server-function middleware that authenticates the
 * caller (requireSupabaseAuth) and then checks the permission, MFA included.
 *
 *   createServerFn({ method: "GET" })
 *     .middleware([requirePermission("finance.read")])
 *     .handler(async ({ context }) => { ... context.supabase, context.userId ... })
 */
import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertPermission, type PermissionContext } from "@/lib/permissions.server";
import type { Permission } from "@/lib/permissions";

export function requirePermission(perm: Permission) {
  return createMiddleware({ type: "function" })
    .middleware([requireSupabaseAuth])
    .server(async ({ next, context }) => {
      await assertPermission(context as PermissionContext, perm);
      return next();
    });
}
