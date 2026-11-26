import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Suspense, useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { resolveMemberClientFn } from "@/lib/members.functions";
import { memberWorkspaceTab } from "@/lib/member-workspace-routing";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { useOverlayMemberId, useCloseMemberProfile } from "@/lib/open-member-profile";

// Lazy-load the workspace so it only ships when a member is opened.
const MemberProfileWorkspace = lazyWithRetry(async () => {
  const mod = await import("@/route-pages/_authenticated/admin/members.$memberId");
  return { default: mod.MemberProfileWorkspace };
});

function Skeleton() {
  return (
    <div className="space-y-4 p-6" aria-busy="true" aria-label="Loading member">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 jf-skeleton rounded-full bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-1/3 jf-skeleton rounded bg-muted" />
          <div className="h-3 w-1/4 jf-skeleton rounded bg-muted" />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 jf-skeleton rounded-lg bg-muted" />
        ))}
      </div>
      <div className="h-64 jf-skeleton rounded-lg bg-muted" />
    </div>
  );
}

export function MemberProfileOverlayMount() {
  const { memberId, memberTab } = useOverlayMemberId();
  const close = useCloseMemberProfile();
  const navigate = useNavigate();
  const resolve = useServerFn(resolveMemberClientFn);
  const linked = useQuery({ queryKey: ["member-client-link", memberId], enabled: !!memberId, queryFn: () => resolve({ data: { memberId: memberId! } }) });
  useEffect(() => {
    if (!memberId || !linked.data?.clientId) return;
    const id = linked.data.clientId;
    void navigate({ to: ".", search: (prev: Record<string, unknown>) => {
      const { memberId: _m, memberTab: _t, ...rest } = prev;
      return { ...rest, clientId: id, clientTab: memberWorkspaceTab(memberTab) };
    }, replace: true } as any);
  }, [memberId, memberTab, linked.data?.clientId, navigate]);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (memberId && typeof document !== "undefined") {
      triggerRef.current = document.activeElement;
    }
  }, [memberId]);

  return (
    <DialogPrimitive.Root
      open={!!memberId && !linked.data?.clientId}
      onOpenChange={(open) => {
        if (!open && !linked.data?.clientId) {
          close();
          setTimeout(() => {
            const el = triggerRef.current as HTMLElement | null;
            if (el && typeof el.focus === "function") el.focus();
          }, 0);
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={[
            "fixed z-50 flex flex-col bg-background text-foreground shadow-2xl outline-none",
            "inset-0 h-[100dvh] w-screen",
            "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
            "md:inset-auto md:left-1/2 md:top-[4vh] md:h-[92vh] md:w-[95vw] md:max-w-[1400px] md:-translate-x-1/2 md:rounded-2xl md:border md:border-border",
            "lg:w-[90vw]",
            "overflow-hidden",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4",
          ].join(" ")}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
          }}
        >
          <DialogPrimitive.Title className="sr-only">Member workspace</DialogPrimitive.Title>

          <DialogPrimitive.Close
            aria-label="Close member workspace"
            className="absolute right-3 top-3 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background/95 text-foreground shadow-sm hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>

          <div className="flex-1 overflow-y-auto">
            <Suspense fallback={<Skeleton />}>
              {linked.isError ? <div className="space-y-3 p-6"><p>Could not resolve this member profile.</p><button className="underline" onClick={() => linked.refetch()}>Try again</button></div> : linked.isPending ? <Skeleton /> : memberId && !linked.data?.clientId ? (
                <MemberProfileWorkspace
                  key={memberId}
                  memberId={memberId}
                  initialTab={memberTab as any}
                  embedded
                  onClose={close}
                />
              ) : null}
            </Suspense>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}