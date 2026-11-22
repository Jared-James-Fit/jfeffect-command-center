import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { getCleoAccessFn } from "@/lib/cleo-access.functions";

/**
 * Whether the signed-in person may use Cleo: every way in (Messages' pinned
 * row, Ask Cleo buttons, the chat sheet itself) shows only while this is true.
 * The admin always; the finance login and coaches only while the admin has
 * them switched on (Settings → AI & Cleo). The server checks the same rule on
 * every Cleo call (cleo-access.server.ts), so hiding a button is never the lock.
 */
export function useCleoAccess(): boolean {
  const { role, accountRole, loading } = useAuth();
  const fn = useServerFn(getCleoAccessFn);
  const admin = accountRole === "admin";
  const staff = role === "admin" || role === "coach";
  const q = useQuery({
    queryKey: ["cleo-access"],
    queryFn: () => fn(),
    enabled: !loading && staff && !admin,
    staleTime: 5 * 60_000,
  });
  if (loading) return false;
  return admin || q.data?.allowed === true;
}
