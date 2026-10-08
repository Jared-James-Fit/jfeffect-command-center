import { useState } from "react";
import { Flag, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { CoachBadge } from "@/components/community/post-card";
import { COMMENT_MAX, postTimeLabel, type CommunityPost } from "@/lib/community";
import { useAddComment, useComments, useDeleteComment } from "@/lib/community.queries";
import { ReportSheet } from "@/components/community/report-sheet";
import { useAuth } from "@/lib/auth";

/**
 * Light chatter on a shared workout. Coaching conversations stay in Messages —
 * this is a quick "nice work", not a thread.
 */
export function CommentsSheet({ post, viewerIsStaff, onClose }: { post: CommunityPost | null; viewerIsStaff: boolean; onClose: () => void }) {
  return (
    <Sheet open={!!post} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideCloseButton className="flex h-[78dvh] max-h-[640px] flex-col gap-0 rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]">
        {post && (
          <>
            <SheetHeader className="shrink-0 border-b border-border/70 px-4 py-3 text-left">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
              <SheetTitle className="text-base font-black">Comments</SheetTitle>
              <SheetDescription className="text-xs">Quick encouragement. Coaching questions belong in Messages.</SheetDescription>
            </div>
                <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
                  <X className="h-4 w-4" />
                </SheetClose>
              </div>
            </SheetHeader>
            <CommentThread key={post.id} post={post} viewerIsStaff={viewerIsStaff} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Comment list + composer. `inline` renders without its own scroll area (post detail). */
export function CommentThread({ post, viewerIsStaff, inline = false }: { post: CommunityPost; viewerIsStaff: boolean; inline?: boolean }) {
  const [text, setText] = useState("");
  const { data: comments = [], isLoading } = useComments(post.id, true);
  const add = useAddComment(post.id, viewerIsStaff, post.is_mine);
  const del = useDeleteComment(post.id);
  const { user } = useAuth();
  const [reportId, setReportId] = useState<string | null>(null);
  const body = text.trim();

  const send = () => {
    if (!body || add.isPending) return;
    add.mutate(body, {
      onSuccess: () => setText(""),
      onError: (e: any) => toast.error(e?.message ?? "Couldn't post that comment"),
    });
  };

  return (
    <>
      <div className={inline ? "space-y-3.5 px-4 py-3" : "min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-4 py-3"}>
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : comments.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No comments yet.</div>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2.5">
              <UserAvatar src={c.author.avatar_url} name={c.author.name} size={30} expandable={false} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-bold">{c.author.name}</span>
                  {c.author.is_coach && <CoachBadge />}
                  <span className="text-[11px] text-muted-foreground">{postTimeLabel(c.created_at)}</span>
                </div>
                <p className="whitespace-pre-line break-words text-[14px] leading-snug">{c.body}</p>
              </div>
              {c.author.user_id !== user?.id && (
                <button
                  type="button"
                  onClick={() => setReportId(c.id)}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
                  aria-label="Report comment"
                >
                  <Flag className="h-3.5 w-3.5" />
                </button>
              )}
              {c.can_delete && (
                <button
                  type="button"
                  onClick={() => del.mutate(c.id, { onError: (e: any) => toast.error(e?.message ?? "Couldn't delete") })}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
                  aria-label="Delete comment"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      <div className={inline ? "px-3 pb-3 pt-1" : "shrink-0 border-t border-border/70 bg-background px-3 pt-2"} style={inline ? undefined : { paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}>
        <div className="flex items-end gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, COMMENT_MAX))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={viewerIsStaff && !post.is_mine ? "Say something to them…" : "Add a comment…"}
            className="min-h-11 flex-1 resize-none rounded-2xl text-[16px]"
            aria-label="Add a comment"
          />
          <Button type="button" size="icon" className="h-11 w-11 shrink-0 rounded-full" disabled={!body || add.isPending} onClick={send} aria-label="Send comment">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <ReportSheet target={reportId ? { commentId: reportId } : null} onClose={() => setReportId(null)} />
    </>
  );
}
