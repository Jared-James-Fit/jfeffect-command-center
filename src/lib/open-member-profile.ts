import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, type MouseEvent } from "react";

export type MemberProfileTab =
  | "summary"
  | "subscription"
  | "access"
  | "setup"
  | "sms"
  | "notes";

export function useOpenMemberProfile() {
  const navigate = useNavigate();
  return useCallback(
    (memberId: string, opts?: { tab?: MemberProfileTab; event?: MouseEvent }) => {
      const ev = opts?.event;
      // Honor modifier keys / middle click for "open in new tab" on real anchors.
      if (ev && (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1)) return;
      ev?.preventDefault();
      navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          memberId,
          memberTab: opts?.tab,
        }),
        replace: false,
      } as any);
    },
    [navigate],
  );
}

export function useCloseMemberProfile() {
  const navigate = useNavigate();
  return useCallback(() => {
    navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => {
        const { memberId: _m, memberTab: _t, ...rest } = prev ?? {};
        return rest;
      },
      replace: false,
    } as any);
  }, [navigate]);
}

export function useOverlayMemberId(): { memberId?: string; memberTab?: string } {
  const search = useRouterState({
    select: (s) => s.location.search as Record<string, unknown>,
  });
  const memberId = typeof search?.memberId === "string" ? (search.memberId as string) : undefined;
  const memberTab = typeof search?.memberTab === "string" ? (search.memberTab as string) : undefined;
  return { memberId, memberTab };
}