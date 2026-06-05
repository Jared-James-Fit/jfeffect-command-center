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
  start: (client: ImpersonatedClient) => void;
  stop: () => void;
}

const STORAGE_KEY = "jfeffect.clientPov";

const Ctx = createContext<ImpersonationState>({
  client: null,
  isImpersonating: false,
  start: () => {},
  stop: () => {},
});

export function ClientImpersonationProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<ImpersonatedClient | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setClient(JSON.parse(raw));
    } catch {}
  }, []);

  const start = useCallback((c: ImpersonatedClient) => {
    setClient(c);
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch {}
  }, []);

  const stop = useCallback(() => {
    setClient(null);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  }, []);

  const value = useMemo(
    () => ({ client, isImpersonating: !!client, start, stop }),
    [client, start, stop],
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