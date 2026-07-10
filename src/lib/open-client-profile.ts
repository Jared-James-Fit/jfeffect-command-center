import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, type MouseEvent } from "react";

export type ClientProfileTab =
  | "summary"
  | "coaching"
  | "info"
  | "account"
  | "messages"
  | "nutrition"
  | "training"
  | "sessions"
  | "billing"
  | "purchases"
  | "agreements"
  | "notes"
  | "documents"
  | "media"
  | "programs";

export function useOpenClientProfile() {
  const navigate = useNavigate();
  return useCallback(
    (clientId: string, opts?: { tab?: ClientProfileTab; event?: MouseEvent }) => {
      const ev = opts?.event;
      // Honor modifier keys / middle click for "open in new tab" on real anchors.
      if (ev && (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1)) return;
      ev?.preventDefault();
      navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          clientId,
          clientTab: opts?.tab,
        }),
        replace: false,
      } as any);
    },
    [navigate],
  );
}

export function useCloseClientProfile() {
  const navigate = useNavigate();
  return useCallback(() => {
    navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => {
        const { clientId: _c, clientTab: _t, ...rest } = prev ?? {};
        return rest;
      },
      replace: false,
    } as any);
  }, [navigate]);
}

export function useOverlayClientId(): { clientId?: string; clientTab?: string } {
  // Read raw location search to avoid depending on parent-route validateSearch typing.
  const search = useRouterState({
    select: (s) => s.location.search as Record<string, unknown>,
  });
  const clientId = typeof search?.clientId === "string" ? (search.clientId as string) : undefined;
  const clientTab = typeof search?.clientTab === "string" ? (search.clientTab as string) : undefined;
  return { clientId, clientTab };
}