import { createFileRoute } from "@tanstack/react-router";
import { SupportConversation } from "@/components/support/support-conversation";

export const Route = createFileRoute("/_authenticated/portal/support")({ component: SupportPage });

/**
 * JF Effect Support on its own screen: the same conversation as the Support
 * chat in Messages (support-conversation.tsx), where the menus, pushes and
 * Help lead (`/portal/messages?chat=support`). This address stays for old
 * links and for the screens a member can still open while setup is unfinished
 * or a membership lapsed (MemberSetupGate, LAPSED_MEMBER_PATHS).
 */
function SupportPage() {
  return (
    <div
      className="phone-column fixed inset-x-0 z-30 flex flex-col bg-background md:static md:inset-auto md:z-auto md:mx-auto md:h-full md:w-full md:max-w-3xl md:flex-1 md:border-x md:border-border"
      style={{
        // Like the coach chat: anchored to the visible part of the screen,
        // so the box sits right above the keyboard, under the top bar.
        top: "calc(var(--vv-top, 0px) + var(--app-top-chrome, 0px))",
        height: "calc(var(--vv-h, 100dvh) - var(--app-top-chrome, 0px) - var(--bottom-nav-clearance, 0px))",
      }}
      data-member-support
    >
      <SupportConversation />
    </div>
  );
}
