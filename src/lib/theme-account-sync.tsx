/**
 * Keeps the Light / Dark / System choice saved on the user's account
 * (user_preferences) so it follows them across devices, reinstalls and
 * sign-outs until they change it again.
 *
 * - A pick → saved to the account at once (retried with backoff; a "dirty"
 *   flag makes sure an offline change is pushed on the next launch).
 * - Sign-in / app back in foreground → the account's choice is applied here.
 *   Whichever side was changed most recently wins.
 * - Nothing is ever written for someone who hasn't chosen: an account with no
 *   saved choice just uses its default (light for an account made before dark
 *   became the default, dark for a new one), so existing preferences are never
 *   reset or overwritten.
 * - Switching accounts on a shared device never inherits the previous
 *   person's choice.
 */
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  clearPreference, defaultPreferenceFor, isPreference, readStoredPreference, readThemeUpdatedAt,
  setDefaultPreference, setTheme,
  THEME_CHANGE_EVENT, THEME_OWNER_KEY,
  type Theme, type ThemeChangeDetail, type ThemePreference,
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

export async function saveThemeToAccount(userId: string, theme: ThemePreference, at: string, attempts = 4) {
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
    // A check the database refuses (an older schema without 'system') won't pass on a retry: keep it on the device, pushed next launch.
    if ((error as { code?: string }).code === "23514") return false;
    await new Promise((r) => setTimeout(r, 800 * 2 ** i));
  }
  return false; // stays dirty → pushed on next launch
}

type Remote = { theme: ThemePreference; theme_updated_at: string } | null;

/**
 * Decide what to do given the device copy and the account copy.
 * Pure so it can be unit-tested.
 *
 * `local` is null when nobody chose anything on this device. `fallback` is the
 * account's default (light for a long-time account, dark for a new one): it is
 * only ever shown, never saved as if it were a choice.
 */
export function reconcileTheme(args: {
  local: ThemePreference | null;
  localAt: string | null;
  localOwner: string | null;
  dirty: boolean;
  userId: string;
  remote: Remote;
  fallback: Theme;
}):
  | { action: "apply"; theme: ThemePreference; at: string }
  | { action: "push"; theme: ThemePreference; at: string }
  | { action: "default"; theme: Theme }
  | { action: "none" } {
  const { local, localAt, localOwner, dirty, userId, remote, fallback } = args;
  const sameOwner = localOwner === userId;
  // A device choice made before accounts were tracked counts as this user's.
  const localIsMine = sameOwner || localOwner === null;
  // A stored choice with no date (from before dates were kept) is still a choice: never dropped.
  const localChoice = local !== null;
  const stamp = localAt ?? new Date(0).toISOString();

  if (!remote) {
    if (localIsMine && localChoice) return { action: "push", theme: local!, at: stamp };
    // Nothing saved for this account: it uses its own default, never the previous person's choice.
    return { action: "default", theme: fallback };
  }
  if (localIsMine && localChoice && (dirty || stamp > remote.theme_updated_at) && local !== remote.theme) {
    return { action: "push", theme: local!, at: stamp };
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
  const fallback = defaultPreferenceFor(user?.created_at);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
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
        const remote = isPreference((data as any)?.theme) ? (data as Remote) : null;
        const decision = reconcileTheme({
          local: readStoredPreference(),
          localAt: readThemeUpdatedAt(),
          localOwner: ls(THEME_OWNER_KEY),
          dirty: ls(DIRTY_KEY) === "1",
          userId,
          remote,
          fallback: fallbackRef.current,
        });
        lsSet(THEME_OWNER_KEY, userId);
        if (decision.action === "apply") setTheme(decision.theme, { source: "account", at: decision.at });
        else if (decision.action === "push") await saveThemeToAccount(userId, decision.theme, decision.at);
        else if (decision.action === "default") {
          // Only ever drop a choice that belongs to someone else (a shared device); never write one for this person.
          if (readStoredPreference() !== null) clearPreference();
          setDefaultPreference(decision.theme);
        }
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
