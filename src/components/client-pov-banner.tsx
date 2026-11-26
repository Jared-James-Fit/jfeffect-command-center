import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowRightLeft, Eye, PenLine, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { PovStartHost } from "@/components/pov/pov-start";
import { beginPov, changePovMode, toPovSession } from "@/lib/pov/pov-client";
import { endPovFn, touchPovFn } from "@/lib/pov/pov-session.functions";
import { POV_TOUCH_MS, timeLeft } from "@/lib/pov/pov-rules";
import { installPovFetchGuard, povEditing, putBackPovEvents, recordPovPage, takePovEvents } from "@/lib/pov/pov-store";

/**
 * A thin red frame around the whole screen while a coach/admin is viewing as a client, so
 * it's obvious at a glance you are NOT in your own account. Pure overlay: it never blocks taps
 * or changes layout.
 */
export function PovFrame() {
  const { isImpersonating, client } = useClientImpersonation();
  if (!isImpersonating || !client) return null;
  return (
    <div
      aria-hidden
      data-pov-frame
      className="pointer-events-none fixed inset-0 z-[70] rounded-[inherit]"
      style={{
        boxShadow:
          "inset 0 0 0 3px var(--destructive), inset 0 0 28px 2px color-mix(in oklab, var(--destructive) 22%, transparent)",
      }}
    />
  );
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function ClientPovBanner() {
  const { client, isImpersonating, stop, returnTo, updatePov } = useClientImpersonation();
  const navigate = useNavigate();
  // The banner sits where the app's top bars normally start (notch included),
  // so they start under it instead (--app-chrome-top / --app-safe-top in
  // styles.css): one bar under the banner, never a notch's worth of gap.
  const ref = useRef<HTMLDivElement | null>(null);
  const shown = isImpersonating && !!client;
  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!shown || !el) return;
    const set = () => root.style.setProperty("--pov-banner-h", `${el.getBoundingClientRect().height}px`);
    set();
    root.setAttribute("data-pov-banner-on", "");
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(set) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.removeAttribute("data-pov-banner-on");
      root.style.removeProperty("--pov-banner-h");
    };
  }, [shown]);

  const back = returnTo ?? (client ? `/admin/clients/${client.id}` : "/admin/clients");
  const pov = client?.pov ?? null;
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const [now, setNow] = useState(() => Date.now());
  const [switching, setSwitching] = useState(false);
  const starting = useRef(false);

  const exit = (why: string = "exit") => {
    const target = back;
    if (pov) void endPovFn({ data: { sessionId: pov.id, why } }).catch(() => {});
    stop();
    navigate({ to: target });
  };

  // Direct database writes are checked before they leave while the view is view-only.
  useEffect(() => {
    if (shown) installPovFetchGuard((import.meta as any).env?.VITE_SUPABASE_URL);
  }, [shown]);

  // A view opened without the server's record (an older entry point, or a reload of one made
  // before this shipped) asks why and starts one; cancelling leaves the account.
  useEffect(() => {
    if (!shown || !client || pov || starting.current) return;
    starting.current = true;
    beginPov(client.id, client.full_name)
      .then((s) => {
        if (s) updatePov(s);
        else exit("cancelled");
      })
      .catch((e) => {
        toast.error(e?.message ?? "Couldn't open the account");
        exit("refused");
      })
      .finally(() => {
        starting.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, client?.id, pov?.id]);

  // Every page opened is on the record.
  useEffect(() => {
    if (pov) recordPovPage(pathname);
  }, [pathname, pov?.id]);

  // Report in once a minute (and when leaving the tab): extends the view, sends what was opened
  // and changed, and learns if it ended (30 minutes idle, 4 hours at most).
  useEffect(() => {
    if (!pov) return;
    let alive = true;
    const touch = async () => {
      const events = takePovEvents();
      try {
        const out = await touchPovFn({ data: { sessionId: pov.id, events } });
        if (!alive) return;
        if (out.status !== "ok") {
          toast.message("This account view ended.", { description: "Views close after 30 minutes without activity." });
          stop();
          navigate({ to: back });
          return;
        }
        const next = toPovSession(out);
        if (next && (next.mode !== pov.mode || next.expiresAt !== pov.expiresAt || next.editUntil !== pov.editUntil)) updatePov(next);
      } catch {
        putBackPovEvents(events);
      }
    };
    const t = window.setInterval(() => void touch(), POV_TOUCH_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 15_000);
    const onHide = () => {
      if (document.visibilityState === "hidden") void touch();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      alive = false;
      window.clearInterval(t);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pov?.id, pov?.mode, pov?.expiresAt, pov?.editUntil]);

  if (!isImpersonating || !client) return <PovStartHost />;

  const editing = povEditing(pov, now);
  const switchClient = () => {
    window.dispatchEvent(new CustomEvent("open-client-pov-picker"));
  };
  const toggleEdits = async () => {
    if (!pov || switching) return;
    setSwitching(true);
    try {
      const next = await changePovMode(pov, editing ? "view" : "edit", client.full_name);
      if (next) {
        updatePov(next);
        toast.success(next.mode === "edit" ? "Edits on for 15 minutes" : "Back to view-only");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't change that");
    } finally {
      setSwitching(false);
    }
  };

  return (
    // data-pov-banner: it steps aside while the workout's Focus fills the screen (styles.css)
    <div
      ref={ref}
      data-pov-banner
      data-pov-mode={editing ? "edit" : "view"}
      className="sticky top-0 z-50 w-full border-b border-destructive/40 bg-destructive/10 text-foreground backdrop-blur"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <PovStartHost />
      <div className="flex min-h-12 items-center gap-2 px-3 py-2 text-sm sm:px-4">
        <Eye className="h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">Viewing as {client.full_name ?? "client"}</div>
          <div className="truncate text-[11px] font-medium text-destructive" data-pov-status>
            {!pov ? "Opening…" : editing ? `Editing · ${timeLeft(pov.editUntil, now)} left` : "View only · your own sign-in"}
          </div>
        </div>
        {pov && (
          <Button
            size="sm"
            variant={editing ? "secondary" : "outline"}
            className="h-8 shrink-0 gap-1 px-2 text-xs"
            onClick={() => void toggleEdits()}
            disabled={switching}
            aria-pressed={editing}
            data-pov-edit-toggle
          >
            <PenLine className="h-3.5 w-3.5" />
            <span>{editing ? "Stop edits" : "Edit"}</span>
          </Button>
        )}
        <Button size="sm" variant="outline" className="hidden h-8 shrink-0 gap-1 px-2 text-xs sm:inline-flex" onClick={switchClient}>
          <ArrowRightLeft className="h-3.5 w-3.5" />
          <span>Switch</span>
        </Button>
        <Button size="sm" className="h-8 shrink-0 gap-1 px-2.5 text-xs" onClick={() => exit()} aria-label="Back to admin">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Back to admin</span>
        </Button>
      </div>
    </div>
  );
}
