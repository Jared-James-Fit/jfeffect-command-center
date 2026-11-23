import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { decodeJwtClaims } from "@/lib/mfa-rules";
import { getTwoStepStatus } from "@/lib/two-step.functions";

export const TWO_STEP_STATUS_KEY = "two-step-status";

/** The signed-in login's two-step status, one query for the gate and Account (two-step.ts). */
export function useTwoStepStatus(enabled = true) {
  const { session } = useAuth();
  const claims = useMemo(() => decodeJwtClaims(session?.access_token), [session?.access_token]);
  const uid = session?.user?.id ?? null;
  const sid = (claims?.session_id as string | undefined) ?? null;
  const aal = (claims?.aal as string | undefined) ?? null;
  const statusFn = useServerFn(getTwoStepStatus);
  const query = useQuery({
    queryKey: [TWO_STEP_STATUS_KEY, uid, sid, aal],
    queryFn: () => statusFn({}),
    enabled: enabled && !!uid,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  return { ...query, uid, sid, aal };
}
