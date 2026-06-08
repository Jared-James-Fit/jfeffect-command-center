import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";

export interface ImpersonatedClient {
  id: string;
  user_id: string | null;
  full_name: string | null;
}

interface ImpersonationState {
  client: ImpersonatedClient | null;
  isImpersonating: boolean;
  returnTo: string | null;
  start: (client: ImpersonatedClient, returnTo?: string | null) => void;
  stop: () => void;
}

const STORAGE_KEY = "jfeffect.clientPov";
const RETURN_KEY = "jfeffect.clientPovReturn";

const Ctx = createContext<ImpersonationState>({
  client: null,
  isImpersonating: false,
  returnTo: null,
  start: () => {},
  stop: () => {},
});

export function ClientImpersonationProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<ImpersonatedClient | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setClient(JSON.parse(raw));
      const ret = sessionStorage.getItem(RETURN_KEY);
      if (ret) setReturnTo(ret);
    } catch {}
  }, []);

  const start = useCallback((c: ImpersonatedClient, ret?: string | null) => {
    setClient(c);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(c));
      if (ret) {
        sessionStorage.setItem(RETURN_KEY, ret);
        setReturnTo(ret);
      } else {
        sessionStorage.removeItem(RETURN_KEY);
        setReturnTo(null);
      }
    } catch {}
  }, []);

  const stop = useCallback(() => {
    setClient(null);
    setReturnTo(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(RETURN_KEY);
    } catch {}
  }, []);

  const value = useMemo(
    () => ({ client, isImpersonating: !!client, returnTo, start, stop }),
    [client, returnTo, start, stop],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useClientImpersonation() {
  return useContext(Ctx);
}

/**
 * Returns the user id whose data the portal should display.
 * When admin is impersonating a client, returns that client's user_id.
 * Otherwise returns the authenticated user's id.
 */
export function usePortalUserId(): string | undefined {
  const { user } = useAuth();
  const { client } = useClientImpersonation();
  return client?.user_id ?? user?.id;
}