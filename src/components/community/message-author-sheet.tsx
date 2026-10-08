import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { AutoGrowTextarea } from "@/components/ui/auto-grow-textarea";
import { useAuth } from "@/lib/auth";
import { useVisualViewportBox } from "@/hooks/use-touch-viewport";
import { signCommunityPaths } from "@/lib/community-media";
import { useDirectThreads, useMessageAuthor } from "@/lib/direct-chats";
import type { CommunityPost } from "@/lib/community";

/**
 * "Message" on someone's post: write to them privately, with the post
 * attached. Between members it goes as a message request (they read it and
 * decide); a coach's post goes to your coach chat; a coach answering a
 * client's post lands in that client's coach chat.
 */
export function MessageAuthorSheet({ post, open, onOpenChange }: { post: CommunityPost; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { role } = useAuth();
  const navigate = useNavigate();
  const send = useMessageAuthor();
  const [body, setBody] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const view = useVisualViewportBox(open);
  const staff = role === "admin" || role === "coach";
  const name = post.author.name;
  const path = post.media_thumb_path ?? (post.media_type === "image" ? post.media_path : null);
  const { data: thumb } = useQuery({
    queryKey: ["community-thumb", path],
    enabled: open && !!path,
    staleTime: 40 * 60_000,
    queryFn: async () => (await signCommunityPaths([path]))[path!] ?? null,
  });
  const { data: threads = [] } = useDirectThreads(open && !staff && !post.author.is_coach);
  const existing = threads.find((t) => t.other.user_id === post.author.user_id) ?? null;
  const full = !!existing?.outgoing && existing.left === 0;

  useEffect(() => {
    if (!open) setBody("");
  }, [open]);

  // Where it's going, in one line.
  const note = post.author.is_coach
    ? `Goes to your coach chat with ${name}.`
    : staff
      ? `Goes to ${name}'s coach chat.`
      : existing?.status === "active"
        ? `Goes to your chat with ${name}.`
        : existing?.incoming
          ? `Replying accepts ${name}'s message request.`
          : full
            ? `You can send more once ${name} replies.`
            : existing?.outgoing
              ? `Adds to your message request to ${name}.`
              : `${name} gets this as a message request and can reply when they see it.`;

  const snippet = (post.caption ?? post.quote ?? "").split("\n")[0]?.trim() || (post.kind === "note" ? "Post" : post.session_title || "Workout");
  const canSend = body.trim().length > 0 && !full && !send.isPending;

  const submit = async () => {
    if (!canSend) return;
    try {
      const r = await send.mutateAsync({ postId: post.id, body: body.trim() });
      onOpenChange(false);
      const open = () => {
        if (r.route === "direct") navigate({ to: "/portal/messages", search: { tab: "groups" } as any, hash: `group=${r.group_id}` });
        else if (r.route === "coach") navigate({ to: "/portal/messages" });
        else navigate({ to: "/admin/messages", search: { client: r.client_id } as any });
      };
      toast.success(r.route === "direct" && r.status === "request" ? `Request sent to ${name}` : `Sent to ${name}`, {
        action: { label: "Open chat", onClick: open },
      });
    } catch (e: any) {
      toast.error(e?.message ?? "That didn't send. Try again.");
    }
  };

  const lift = view?.keyboard ? Math.max(0, window.innerHeight - view.top - view.height) : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        className="mx-auto max-w-lg gap-0 rounded-t-3xl p-0 pb-[max(env(safe-area-inset-bottom),0.75rem)]"
        style={{ bottom: lift }}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus({ preventScroll: true });
        }}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted" aria-hidden />
        <div className="flex items-center gap-3 px-4 pb-3 pt-2">
          {thumb ? (
            <img src={thumb} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
          ) : (
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-lg">💬</span>
          )}
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate text-[15px] font-bold">Message {name}</SheetTitle>
            <SheetDescription className="truncate text-[12px]">{snippet}</SheetDescription>
          </div>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-full" aria-label="Close">
              <X className="h-5 w-5" />
            </Button>
          </SheetClose>
        </div>
        <div className="flex items-end gap-2 px-4">
          <AutoGrowTextarea
            ref={inputRef}
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 2000))}
            placeholder={`Message ${name}…`}
            enterKeyHint="enter"
            disabled={full}
            className="min-h-11 max-h-40 flex-1 resize-none rounded-[22px] border-input bg-background px-4 py-[11px] text-base leading-5"
          />
          <Button
            type="button"
            size="icon"
            onClick={submit}
            disabled={!canSend}
            className="h-11 w-11 shrink-0 rounded-full transition-transform active:scale-90"
            aria-label="Send"
          >
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="px-5 pt-2 text-[12px] text-muted-foreground">{note}</p>
      </SheetContent>
    </Sheet>
  );
}
