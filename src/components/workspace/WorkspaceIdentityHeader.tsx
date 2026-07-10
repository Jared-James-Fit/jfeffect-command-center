import { ArrowLeft, MessageSquare, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import type { WorkspaceIdentity } from "./types";
import type { ReactNode } from "react";

const TONE_TO_BADGE_CLASS: Record<string, string> = {
  default: "",
  primary: "border-primary/40 bg-primary/10 text-primary",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  rose: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
};

/**
 * Sticky identity header used at the top of a workspace overlay.
 * Extracted verbatim from the coaching client overlay so both Coaching and
 * Membership share the exact same look and interaction.
 */
export function WorkspaceIdentityHeader({
  identity,
  onClose,
  onMessage,
  onSave,
  isDirty,
  saving,
  primaryAction,
  moreMenu,
}: {
  identity: WorkspaceIdentity;
  onClose?: () => void;
  onMessage?: () => void;
  onSave?: () => unknown | Promise<unknown>;
  isDirty?: boolean;
  saving?: boolean;
  /** Right-aligned primary CTA before the More menu (e.g. POV button). */
  primaryAction?: ReactNode;
  moreMenu?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex items-center gap-3 px-4 py-3 md:px-6">
        <UserAvatar
          src={identity.avatarUrl ?? null}
          name={identity.name}
          size={44}
          className="rounded-xl shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <div className="truncate text-base font-bold leading-tight md:text-lg">
              {identity.name || "Unnamed"}
            </div>
            {identity.titleAfter}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            {identity.badges?.map((b, i) => (
              <Badge
                key={`${b.label}-${i}`}
                variant="outline"
                className={`text-[10px] leading-none py-0.5 ${TONE_TO_BADGE_CLASS[b.tone ?? "default"]}`}
              >
                {b.label}
              </Badge>
            ))}
            {/* Caller is responsible for any leading "·" prefix and responsive
                visibility on each meta chunk — the header just wraps each in a
                truncating span so both Coaching and Membership can render the
                exact same layout without shell-side special-casing. */}
            {identity.meta?.map((chunk, i) => (
              <span key={i} className="truncate">{chunk}</span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onMessage && (
            <>
              <Button variant="outline" size="sm" onClick={onMessage} className="hidden sm:inline-flex">
                <MessageSquare className="mr-2 h-4 w-4" />Message
              </Button>
              <Button variant="ghost" size="icon" onClick={onMessage} className="sm:hidden" aria-label="Message">
                <MessageSquare className="h-5 w-5" />
              </Button>
            </>
          )}
          {primaryAction}
          {isDirty && onSave && (
            <Button size="sm" className="bg-gradient-primary uppercase font-bold" onClick={() => onSave()} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />Save
            </Button>
          )}
          {moreMenu}
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="hidden md:inline-flex">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}