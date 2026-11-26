import { useSyncExternalStore, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { BellOff, Pin } from "lucide-react";
import { NameMarks } from "@/components/name-marks";
import { cn } from "@/lib/utils";
import { activityAge } from "@/lib/crew-activity";
import { StoryRing, useStoryRing } from "@/components/community/story-ring";

/**
 * Instagram's DM list, everywhere a list of chats shows (the coach inbox, the
 * client's Messages, Requests, coach-run groups): a 56px face, the name at
 * 16px, the latest message at 15px with its age after it ("· 5m"), ~72px
 * rows with no dividers, a blue dot for unread. Read names are regular
 * weight; unread ones, and their preview, are semibold.
 */
export const CHAT_ROW_AVATAR = 56;

/** Instagram's unread blue (red is for errors, overdue and delete). */
export const UNREAD_DOT = "bg-[#0095F6]";

/* One ticker for every row on screen: the snapshot is the current minute, so
   "· 5m" moves on by itself without a timer per row. */
const minute = () => Math.floor(Date.now() / 60_000);
const listeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | null = null;
function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!ticker) ticker = setInterval(() => listeners.forEach((f) => f()), 30_000);
  return () => {
    listeners.delete(cb);
    if (!listeners.size && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  };
}
function useMinute() {
  return useSyncExternalStore(subscribe, minute, minute);
}

/** "now", "5m", "3h", "2d", "1w": the age shown after a chat's latest message. */
export function chatAge(at: string | null | undefined, now = Date.now()): string {
  if (!at) return "";
  const t = new Date(at).getTime();
  return Number.isFinite(t) ? activityAge(at, now) : "";
}

export function ChatListRow({
  avatar,
  name,
  preview,
  at,
  unread = false,
  dot = true,
  unreadLabel,
  muted = false,
  pinned = false,
  selected = false,
  dim = false,
  leading,
  extra,
  after,
  label,
  as = "button",
  onClick,
  onPointerDown,
  className,
  storyUserId,
  storyName,
  ...data
}: {
  /** The face, sized CHAT_ROW_AVATAR. */
  avatar: ReactNode;
  name: ReactNode;
  /** The latest message (or what's waiting). */
  preview: ReactNode;
  /** When the latest message was sent (ISO): shown as "· 5m" after the preview. */
  at?: string | null;
  unread?: boolean;
  /** The blue dot while unread (off when `after` already says it). */
  dot?: boolean;
  /** What the dot says to a screen reader. */
  unreadLabel?: string;
  /** Hide Alerts is on. */
  muted?: boolean;
  /** Pinned to the top of the list: a small pin on the right (iMessage). */
  pinned?: boolean;
  selected?: boolean;
  /** An archived chat. */
  dim?: boolean;
  /** Before the face (the round check while selecting). */
  leading?: ReactNode;
  /** A third line under the preview (the coach's signals). */
  extra?: ReactNode;
  /** On the right, before the unread dot (a count, an archived mark). */
  after?: ReactNode;
  label?: string;
  /** "div" when the row holds a button of its own (a button can't hold another). */
  as?: "button" | "div";
  onClick?: () => void;
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void;
  className?: string;
  /**
   * The person this chat is with: their story ring on the face while they
   * have a story up, and a tap on the face plays it (Instagram's DM list);
   * the rest of the row still opens the chat. No story: the face as it is.
   */
  storyUserId?: string | null;
  storyName?: string;
  [data: `data-${string}`]: string | boolean | undefined;
}) {
  useMinute(); // re-render as the minute turns
  const story = useStoryRing(storyUserId);
  const storied = story.state !== "none";
  const face = storied ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!story.open()) onClick?.();
      }}
      className="shrink-0 rounded-full active:scale-95"
      aria-label={`Watch ${storyName ?? "their"}${storyName ? "'s" : ""} story${story.state === "seen" ? "" : ", new"}`}
      data-story-avatar={story.state}
    >
      <StoryRing state={story.state} size={CHAT_ROW_AVATAR}>
        {avatar}
      </StoryRing>
    </button>
  ) : (
    avatar
  );
  // a face that plays a story is a button of its own, so the row can't be one
  const tag = storied ? "div" : as;
  const age = chatAge(at);
  const classes = cn(
    "flex min-h-[72px] w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-secondary/40",
    tag === "div" && "cursor-pointer",
    selected && "bg-secondary/60",
    dim && "opacity-60",
    className,
  );
  const body = (
    <>
      {leading}
      {face}
      <span className="block min-w-0 flex-1">
        <span
          data-chat-name
          className={cn("flex min-w-0 items-center gap-1 text-[16px] leading-5 text-foreground", unread ? "font-semibold" : "font-normal")}
        >
          <span className="truncate">{name}</span>
          {/* a person's 1:1: their membership badge (and Virtual), never on a group */}
          {storyUserId && <NameMarks userId={storyUserId} size={13} />}
        </span>
        <span
          data-chat-preview
          className={cn(
            "mt-0.5 flex min-w-0 items-baseline text-[15px] leading-5",
            unread ? "font-semibold text-foreground" : "text-muted-foreground",
          )}
        >
          <span className="truncate">{preview}</span>
          {/* the age stays grey and regular, unread or not (Instagram's "2 new messages · 1m") */}
          {age && <span className="shrink-0 whitespace-pre font-normal text-muted-foreground" data-chat-age>{` · ${age}`}</span>}
        </span>
        {extra}
      </span>
      {(muted || pinned || after || (unread && dot)) && (
        <span className="flex shrink-0 items-center gap-2">
          {muted && <BellOff className="h-4 w-4 text-muted-foreground" aria-label="Alerts hidden" />}
          {pinned && <Pin className="h-3.5 w-3.5 rotate-45 text-muted-foreground/80" aria-label="Pinned" data-chat-pinned />}
          {after}
          {unread && dot && (
            <span
              data-chat-unread
              className={cn("h-2.5 w-2.5 rounded-full", UNREAD_DOT)}
              role="img"
              aria-label={unreadLabel ?? "Unread"}
            />
          )}
        </span>
      )}
    </>
  );
  if (tag === "div") {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick?.();
          }
        }}
        className={classes}
        {...data}
      >
        {body}
      </div>
    );
  }
  return (
    <button type="button" aria-label={label} onClick={onClick} onPointerDown={onPointerDown} className={classes} {...data}>
      {body}
    </button>
  );
}
