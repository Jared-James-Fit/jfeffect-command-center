import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { FullPageLoader } from "@/components/full-page-loader";
import { useCoachingAgreement } from "@/components/coaching-agreement/agreement-context";

// Removed page: the Coaching Agreement lives in Account (the same card), so this
// address only lands there. It never listed anything else: no native agreement
// was ever sent and the one old SignNow record was never sent either.
// `?sign=1` (the "please sign" push and email) still opens the signing flow,
// which is app-wide and stays open over Account.
const ACCOUNT_AGREEMENT = { to: "/portal/account", hash: "coaching-agreement", replace: true } as const;

export const Route = createFileRoute("/_authenticated/portal/agreements/")({
  validateSearch: (search: Record<string, unknown>): { sign?: "1" } =>
    search.sign === "1" || search.sign === 1 ? { sign: "1" } : {},
  beforeLoad: ({ search }) => {
    if (search.sign !== "1") throw redirect(ACCOUNT_AGREEMENT);
  },
  component: SignThenAccount,
});

function SignThenAccount() {
  const navigate = useNavigate();
  const { state, isLoading, needsSignature, canSign, openSignFlow } = useCoachingAgreement();
  useEffect(() => {
    if (isLoading && !state) return;
    if (needsSignature && canSign) openSignFlow();
    navigate(ACCOUNT_AGREEMENT);
  }, [state, isLoading, needsSignature, canSign, openSignFlow, navigate]);
  return <FullPageLoader />;
}
