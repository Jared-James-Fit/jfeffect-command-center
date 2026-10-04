/**
 * Keeps the light/dark choice saved on the user's account (user_preferences)
 * so it follows them across devices, reinstalls and sign-outs until they
 * change it again.
 *
 * - Toggle → saved to the account (retried with backoff; a "dirty" flag
 *   makes sure an offline change is pushed on the next launch).
 * - Sign-in / app back in foreground → the account's choice is applied here.
 *   Whichever side was changed most recently wins.
 * - Switching accounts on a shared device never inherits the previous
 *   person's choice: a new account with nothing saved starts in light.
 */
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  readStoredTheme, readThemeUpdatedAt, setTheme,
  THEME_CHANGE_EVENT, THEME_OWNER_KEY,
  type Theme, type ThemeChangeDetail,
} from "@/lib/theme";

const db = supabase as any;
const DIRTY_KEY = "jf-theme-dirty";

function ls(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage unavailable */ }
}

export async function saveThemeToAccount(userId: string, theme: Theme, at: string, attempts = 4) {
  lsSet(DIRTY_KEY, "1");
  for (let i = 0; i < attempts; i++) {
    const { error } = await db.from("user_preferences").upsert(
      { user_id: userId, theme, theme_updated_at: at, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    if (!error) {
      lsSet(DIRTY_KEY, null);
      return true;
    }
    await new Promise((r) => setTimeout(r, 800 * 2 ** i));
  }
  return false; // stays dirty → pushed on next launch
}

type Remote = { theme: Theme; theme_updated_at: string } | null;

/**
 * Decide what to do given the device copy and the account copy.
 * Pure so it can be unit-tested.
 */
export function reconcileTheme(args: {
  local: Theme;
  localAt: string | null;
  localOwner: string | null;
  dirty: boolean;
  userId: string;
  remote: Remote;
}): { action: "apply"; theme: Theme; at: string } | { action: "push"; theme: Theme; at: string } | { action: "none" } {
  const { local, localAt, localOwner, dirty, userId, remote } = args;
  const sameOwner = localOwner === userId;
  // A device choice made before accounts were tracked counts as this user's.
  const localIsMine = sameOwner || localOwner === null;

  if (!remote) {
    if (localIsMine && localAt) return { action: "push", theme: local, at: localAt };
    // Different account on this device and nothing saved yet → default light.
    return local === "light" ? { action: "none" } : { action: "apply", theme: "light", at: new Date(0).toISOString() };
  }
  if (localIsMine && localAt && (dirty || localAt > remote.theme_updated_at) && local !== remote.theme) {
    return { action: "push", theme: local, at: localAt };
  }
  if (remote.theme !== local || !sameOwner) {
    return { action: "apply", theme: remote.theme, at: remote.theme_updated_at };
  }
  return { action: "none" };
}

/** Mount once inside the signed-in app. Renders nothing. */
export function ThemeAccountSync() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const syncing = useRef(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const sync = async () => {
      if (syncing.current) return;
      syncing.current = true;
      try {
        const { data, error } = await db
          .from("user_preferences")
          .select("theme, theme_updated_at")
          .eq("user_id", userId)
          .maybeSingle();
        if (cancelled || error) return;
        const decision = reconcileTheme({
          local: readStoredTheme(),
          localAt: readThemeUpdatedAt(),
          localOwner: ls(THEME_OWNER_KEY),
          dirty: ls(DIRTY_KEY) === "1",
          userId,
          remote: (data as Remote) ?? null,
        });
        lsSet(THEME_OWNER_KEY, userId);
        if (decision.action === "apply") setTheme(decision.theme, { source: "account", at: decision.at });
        else if (decision.action === "push") await saveThemeToAccount(userId, decision.theme, decision.at);
      } finally {
        syncing.current = false;
      }
    };

    // Save every toggle to the account.
    const onChange = (e: Event) => {
      const d = (e as CustomEvent<ThemeChangeDetail>).detail;
      if (!d || d.source !== "user") return;
      lsSet(THEME_OWNER_KEY, userId);
      void saveThemeToAccount(userId, d.theme, d.at);
    };
    // Pick up a change made on another device when the app comes back.
    const onVisible = () => { if (document.visibilityState === "visible") void sync(); };

    void sync();
    window.addEventListener(THEME_CHANGE_EVENT, onChange);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener(THEME_CHANGE_EVENT, onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId]);

  return null;
}
