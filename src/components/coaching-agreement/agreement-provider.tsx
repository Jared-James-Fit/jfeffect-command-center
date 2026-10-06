import { lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { usePovFn } from "@/lib/client-pov-args";
import { getMyAgreementState } from "@/lib/coaching-agreement.functions";
import {
  AgreementContext,
  AGREEMENT_QUERY_ROOT,
  type AgreementContextValue,
} from "./agreement-context";
import { AgreementLaunchPopup } from "./agreement-launch-popup";

// The full signing flow carries the whole agreement text, so it loads only when first opened.
const AgreementSignFlow = lazy(() =>
  import("./agreement-sign-flow").then((m) => ({ default: m.AgreementSignFlow })),
);

export function CoachingAgreementProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { isImpersonating, client: povClient } = useClientImpersonation();
  const getState = usePovFn(useServerFn(getMyAgreementState));
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: [AGREEMENT_QUERY_ROOT, "state", user?.id ?? "anon", povClient?.id ?? "self"],
    enabled: !!user?.id,
    queryFn: () => getState({ data: {} }),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const canSign = !isImpersonating;
  const needsSignature = canSign && !!data?.applicable && data.state?.state === "needs_signature";

  const openSignFlow = useCallback(() => {
    if (!canSign) return;
    setEverOpened(true);
    setOpen(true);
  }, [canSign]);

  const value = useMemo<AgreementContextValue>(
    () => ({ state: data, isLoading, needsSignature, canSign, openSignFlow }),
    [data, isLoading, needsSignature, canSign, openSignFlow],
  );

  return (
    <AgreementContext.Provider value={value}>
      {children}
      {canSign && <AgreementLaunchPopup flowOpen={open} />}
      {everOpened && (
        <Suspense fallback={null}>
          <AgreementSignFlow open={open} onOpenChange={setOpen} />
        </Suspense>
      )}
    </AgreementContext.Provider>
  );
}
