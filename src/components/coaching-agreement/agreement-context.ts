import { createContext, useContext } from "react";
import type { AgreementStateResponse } from "@/lib/coaching-agreement.functions";

export type AgreementContextValue = {
  state: AgreementStateResponse | undefined;
  isLoading: boolean;
  /** The client must sign (or re-sign) and it is their own session. */
  needsSignature: boolean;
  /** Coach "View as client" can see status but never sign for the client. */
  canSign: boolean;
  openSignFlow: () => void;
};

export const AgreementContext = createContext<AgreementContextValue>({
  state: undefined,
  isLoading: false,
  needsSignature: false,
  canSign: false,
  openSignFlow: () => {},
});

export function useCoachingAgreement(): AgreementContextValue {
  return useContext(AgreementContext);
}

/**
 * Query-key root for everything agreement-related. It is on the persister's
 * do-not-persist list, so a stale "unsigned" snapshot can never flash on the
 * phone after signing.
 */
export const AGREEMENT_QUERY_ROOT = "coaching-agreement";
