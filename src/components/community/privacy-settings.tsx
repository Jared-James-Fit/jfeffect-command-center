import { useState } from "react";
import { Globe } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { useFollowState, useSetPrivate } from "@/lib/community-social";
import { useMyCommunitySettings, useSetAutoShare } from "@/lib/community.queries";
import { useServiceTier } from "@/lib/service-tier";

/**
 * Who sees what you post, in Edit profile's Privacy section (Instagram keeps
 * "Account privacy" in settings, not on the profile itself).
 *
 * - Private account (athletes only): your own posts and stories reach only
 *   followers you approve (and your coach). Your automatic workout stories
 *   stay public either way, like every coach post (daily posts, lessons,
 *   birthdays, Wins), so the Crew's shared wins never go dark.
 * - A coach's account is always public: shown as a fact, not a switch.
 * - Share my workouts: a finished workout posts itself to your story.
 */

const ROW = "flex items-center justify-between gap-3 border-b border-border/60 px-3.5 py-3";
const TITLE = "block text-[13px] font-bold";
const NOTE = "block text-[11.5px] leading-snug text-muted-foreground";

/** Private account on / off, asking first like Instagram (going public lets everyone waiting in). */
export function PrivateAccountRow() {
  const { isImpersonating } = useClientImpersonation();
  const { data: state } = useFollowState(!isImpersonating);
  const set = useSetPrivate();
  const [ask, setAsk] = useState<boolean | null>(null);
  // staff still see followers-only posts: "your coach" for coaching clients, never coach wording for members
  const { isSelfServe } = useServiceTier();
  const staff = isSelfServe ? "The JF Effect team" : "Your coach";
  if (isImpersonating || !state) return null;
  const waiting = state.requests.length;
  const save = (on: boolean) =>
    set.mutate(on, {
      onSuccess: () => toast.success(on ? "Your account is private" : "Your account is public", { description: on ? "People who already follow you still do." : waiting ? "Everyone waiting to follow you is in now." : undefined }),
      onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
    });
  return (
    <>
      <label data-private-switch className={ROW}>
        <span className="min-w-0">
          <span className={TITLE}>Private account</span>
          <span className={NOTE}>
            {state.is_private
              ? `Only followers you approve see your posts and stories. ${staff} always can.`
              : "Anyone in the crew can follow you and see your posts and stories."}
            {" "}Automatic workout stories are always public.
          </span>
        </span>
        <Switch checked={state.is_private} disabled={set.isPending} onCheckedChange={(on) => setAsk(on)} aria-label="Private account" />
      </label>
      <Sheet open={ask !== null} onOpenChange={(o) => !o && setAsk(null)}>
        <SheetContent side="bottom" hideCloseButton className="gap-0 rounded-t-[24px] p-0 pb-safe-bottom sm:mx-auto sm:max-w-[420px]">
          <div data-private-confirm className="px-6 pb-3 pt-6 text-center">
            <SheetTitle className="text-[16px] font-black">{ask ? "Switch to private account?" : "Switch to public account?"}</SheetTitle>
            <SheetDescription className="mt-2 text-[13px] leading-snug">
              {ask
                ? `Only followers you approve will see your posts and stories. People who already follow you still will, and so will ${staff === "Your coach" ? "your coach" : "the JF Effect team"}. Your automatic workout stories stay public.`
                : `Anyone in the crew will be able to see your posts and stories.${waiting ? ` ${waiting === 1 ? "The 1 person" : `The ${waiting} people`} waiting to follow you will be approved.` : ""}`}
            </SheetDescription>
          </div>
          <div className="border-t border-border/60">
            <button
              type="button"
              className="h-12 w-full text-[14px] font-bold text-primary active:bg-muted"
              onClick={() => {
                const on = !!ask;
                setAsk(null);
                save(on);
              }}
            >
              {ask ? "Switch to private" : "Switch to public"}
            </button>
            <SheetClose className="h-12 w-full border-t border-border/60 text-[14px] font-semibold active:bg-muted">Cancel</SheetClose>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** A coach's account: public, always (their posts are for the whole crew). */
export function CoachPublicRow() {
  return (
    <div data-coach-public className={ROW}>
      <span className="min-w-0">
        <span className={TITLE}>Public account</span>
        <span className={NOTE}>Coach accounts are always public, so everything you post reaches the whole crew.</span>
      </span>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden>
        <Globe className="h-4 w-4" />
      </span>
    </div>
  );
}

/** Automatic sharing: a finished workout posts itself to your story (24 hours), public to the crew. */
export function ShareWorkoutsRow() {
  const { isImpersonating } = useClientImpersonation();
  const { data } = useMyCommunitySettings(!isImpersonating);
  const set = useSetAutoShare();
  if (isImpersonating || !data) return null;
  return (
    <label data-pulse-switch className={ROW}>
      <span className="min-w-0">
        <span className={TITLE}>Share my workouts</span>
        <span className={NOTE}>Finished workouts post to your story for 24 hours with the session's best win. Everyone in the crew sees them.</span>
      </span>
      <Switch checked={data.auto_share_workouts} disabled={set.isPending} onCheckedChange={(on) => set.mutate(on, { onError: () => toast.error("Couldn't save that") })} aria-label="Share my workouts" />
    </label>
  );
}
