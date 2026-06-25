import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export interface ImpersonatedTeamMember {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
}

interface TeamImpersonationState {
  member: ImpersonatedTeamMember | null;
  isImpersonating: boolean;
  returnTo: string | null;
  start: (m: ImpersonatedTeamMember, returnTo?: string | null) => void;
  stop: () => void;
}

const STORAGE_KEY = "jfeffect.teamPov";
const RETURN_KEY = "jfeffect.teamPovReturn";

function readStored(): ImpersonatedTeamMember | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function readReturn(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(RETURN_KEY) || localStorage.getItem(RETURN_KEY);
  } catch {
    return null;
  }
}

const Ctx = createContext<TeamImpersonationState>({
  member: null,
  isImpersonating: false,
  returnTo: null,
  start: () => {},
  stop: () => {},
});

export function TeamImpersonationProvider({ children }: { children: ReactNode }) {
  const [member, setMember] = useState<ImpersonatedTeamMember | null>(() => readStored());
  const [returnTo, setReturnTo] = useState<string | null>(() => readReturn());

  useEffect(() => {
    const m = readStored();
    const r = readReturn();
    if (m) setMember(m);
    if (r) setReturnTo(r);
  }, []);

  const start = useCallback((m: ImpersonatedTeamMember, ret?: string | null) => {
    setMember(m);
    try {
      const payload = JSON.stringify(m);
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
    setMember(null);
    setReturnTo(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(RETURN_KEY);
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(RETURN_KEY);
    } catch {}
  }, []);

  const value = useMemo(
    () => ({ member, isImpersonating: !!member, returnTo, start, stop }),
    [member, returnTo, start, stop],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTeamImpersonation() {
  return useContext(Ctx);
}

/** Returns the team member user_id whose POV is active, or null. */
export function useTeamPovUserId(): string | null {
  const { member } = useTeamImpersonation();
  return member?.user_id ?? null;
}