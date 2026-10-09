/**
 * Whether the signed-in admin owns the business books (Taxes & Books).
 * undefined while loading; RLS enforces the same rule server side.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export const OWNER_ONLY_PATHS = ["/admin/sales?tab=taxes"];

export function useIsBusinessOwner(): boolean | undefined {
  const { user, role } = useAuth();
  const { data } = useQuery({
    queryKey: ["is-business-owner", user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("is_business_owner", { _uid: user!.id });
      return !error && data === true;
    },
    enabled: !!user?.id && role === "admin",
    staleTime: 10 * 60_000,
  });
  return role === "admin" ? data : false;
}

/** Drop owner-only destinations from a nav tree for admins who aren't the owner. */
export function withoutOwnerOnly<T extends { to: string; children?: T[] }>(items: T[]): T[] {
  return items
    .filter((i) => !OWNER_ONLY_PATHS.includes(i.to))
    .map((i) => (i.children ? { ...i, children: withoutOwnerOnly(i.children) } : i));
}
