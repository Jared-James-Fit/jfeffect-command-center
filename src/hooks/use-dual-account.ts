import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type StaffDestination = "/admin" | "/media";

export interface DualAccountInfo {
  hasDual: boolean;
  hasClient: boolean;
  staffDestination: StaffDestination | null;
  loading: boolean;
}

/**
 * Detects users who have BOTH a client record in the `clients` table AND a
 * staff role (admin / coach / media_manager) in `user_roles`. Such users
 * need a way to switch between their client portal (workouts, check-ins)
 * and their staff workspace without signing out.
 */
export function useDualAccount(): DualAccountInfo {
  const { user, role, loading: authLoading } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["dual-account", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const uid = user!.id;
      const [{ data: clientRow }, { data: roleRows }] = await Promise.all([
        supabase.from("clients").select("id").eq("user_id", uid).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", uid),
      ]);
      const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
      const isAdmin = roles.includes("admin");
      const isCoach = roles.includes("coach");
      const isMedia = roles.includes("media_manager");
      const isStaff = isAdmin || isCoach || isMedia;
      const dest: StaffDestination | null =
        isAdmin || isCoach ? "/admin"
        : isMedia ? "/media"
        : null;
      return { hasClient: !!clientRow, isStaff, staffDestination: dest };
    },
  });

  // Use cached role as a fast hint while the query loads — current role
  // === "client" still allows hasDual to flip true once the staff role is
  // confirmed by the query.
  const hasDual = !!data?.hasClient && !!data?.isStaff;
  return {
    hasDual,
    hasClient: !!data?.hasClient,
    staffDestination: data?.staffDestination ?? (role === "media_manager" ? "/media" : "/admin"),
    loading: authLoading || isLoading,
  };
}