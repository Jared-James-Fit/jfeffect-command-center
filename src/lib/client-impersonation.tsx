import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import type { PovSession } from "@/lib/pov/pov-rules";
import { setPovSession } from "@/lib/pov/pov-store";

export interface ImpersonatedClient {
  id: string;
  user_id: string | null;
  full_name: string | null;
  /** The server's record of this view (admin_pov_sessions): view-only or edits on, until when. */
  pov?: PovSession | null;
}

interface ImpersonationState {
  client: ImpersonatedClient | null;
  isImpersonating: boolean;
  returnTo: string | null;
  start: (client: ImpersonatedClient, returnTo?: string | null) => void;
  stop: () => void;
  /** The view's session changed (edits on / off, extended, ended). */
  updatePov: (pov: PovSession | null) => void;
}

const STORAGE_KEY = "jfeffect.clientPov";
const RETURN_KEY = "jfeffect.clientPovReturn";

function readStoredClient(): ImpersonatedClient | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** A "View as client" session is saved on this device (sync, for app launch). */
export function hasStoredClientPov(): boolean {
  return readStoredClient() !== null;
}

function readStoredReturnTo(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(RETURN_KEY) || localStorage.getItem(RETURN_KEY);
  } catch {
    return null;
  }
}

const Ctx = createContext<ImpersonationState>({
  client: null,
  isImpersonating: false,
  returnTo: null,
  start: () => {},
  stop: () => {},
  updatePov: () => {},
});

export function ClientImpersonationProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<ImpersonatedClient | null>(() => {
    const c = readStoredClient();
    // before the first render's server calls go out
    setPovSession(c?.pov ?? null);
    return c;
  });
  const [returnTo, setReturnTo] = useState<string | null>(() => readStoredReturnTo());

  useEffect(() => {
    const storedClient = readStoredClient();
    const storedReturnTo = readStoredReturnTo();
    if (storedClient) setClient(storedClient);
    if (storedReturnTo) setReturnTo(storedReturnTo);
  }, []);

  // The server-call middleware and the fetch guard read the open view from outside React.
  useEffect(() => {
    setPovSession(client?.pov ?? null);
  }, [client]);

  const start = useCallback((c: ImpersonatedClient, ret?: string | null) => {
    setClient(c);
    setPovSession(c.pov ?? null);
    try {
      const payload = JSON.stringify(c);
      sessionStorage.setItem(STORAGE_KEY, payload);
      localStorage.setItem(STORAGE_KEY, payload);
      if (ret) {
        sessionStorage.setItem(RETURN_KEY, ret);
        localStorage.setItem(RETURN_KEY, ret);
        setReturnTo(ret);
      } else {
        sessionStorage.removeItem(RETURN_KEY);
        localStorage.removeItem(RETURN_KEY);
        setReturnTo(null);
      }
    } catch {}
  }, []);

  const stop = useCallback(() => {
    setClient(null);
    setPovSession(null);
    setReturnTo(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(RETURN_KEY);
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(RETURN_KEY);
    } catch {}
  }, []);

  const updatePov = useCallback((pov: PovSession | null) => {
    setClient((c) => {
      if (!c) return c;
      const next = { ...c, pov };
      try {
        const payload = JSON.stringify(next);
        sessionStorage.setItem(STORAGE_KEY, payload);
        localStorage.setItem(STORAGE_KEY, payload);
      } catch {}
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ client, isImpersonating: !!client, returnTo, start, stop, updatePov }),
    [client, returnTo, start, stop, updatePov],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useClientImpersonation() {
  return useContext(Ctx);
}

/**
 * True while a coach/admin is viewing as a client. Anything that records what
 * the client has seen or done (read receipts, unread dots, "viewed" stamps,
 * presence, typing) must stay off while this is true.
 */
export function useViewingAsClient(): boolean {
  const { user } = useAuth();
  const { client } = useClientImpersonation();
  return !!client && !!user && user.id !== client.user_id;
}

/**
 * Returns the user id whose data the portal should display.
 * When admin is impersonating a client, returns that client's user_id.
 * Otherwise returns the authenticated user's id.
 */
export function usePortalUserId(): string | undefined {
  const { user } = useAuth();
  const { client } = useClientImpersonation();
  // When impersonating, always use the client's user_id — even if null/undefined
  // (account not yet set up). Returning the admin's own id here would mix their
  // personal data into the client POV, which is wrong.
  if (client) return client.user_id ?? undefined;
  return user?.id;
}