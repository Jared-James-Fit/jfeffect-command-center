import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AudiencePicker } from "@/components/community/audience-picker";
import { CAPTION_MAX, type CommunityPost, type CommunityVisibility } from "@/lib/community";
import { useEditPost } from "@/lib/community.queries";

/**
 * Edit your own workout post, Instagram-style: caption, who it's for, hide
 * weights. The photo and the workout stay as they are. A caption change
 * shows "Edited" on the post.
 */
export function EditPostSheet({ post, onClose }: { post: CommunityPost | null; onClose: () => void }) {
  const edit = useEditPost();
  const archived = !!post?.archived_at;
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState<CommunityVisibility>("community");
  const [hideLoads, setHideLoads] = useState(false);

  useEffect(() => {
    if (!post) return;
    setCaption(post.caption ?? "");
    // an archived post shows "only me" until it's restored; edit the audience it goes back to
    setVisibility(archived ? post.archived_from ?? "community" : post.visibility);
    setHideLoads(!!post.hide_loads);
  }, [post, archived]);

  const save = async () => {
    if (!post) return;
    try {
      await edit.mutateAsync({ postId: post.id, caption, visibility, hideLoads });
      toast.success("Post updated");
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save that");
    }
  };

  return (
    <Sheet open={!!post} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideCloseButton className="max-h-[90dvh] gap-0 overflow-y-auto rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]">
        <SheetHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-border/60 px-5 pb-3 pt-4 text-left">
          <div className="min-w-0">
            <SheetTitle className="text-[16px] font-black">Edit post</SheetTitle>
            <SheetDescription className="text-[12px]">{archived ? "It's archived. Changes apply when you restore it." : "The photo and workout stay the same."}</SheetDescription>
          </div>
          <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </SheetClose>
        </SheetHeader>
        <div className="space-y-4 px-5 py-4">
          <div>
            <Textarea
              value={caption}
              maxLength={CAPTION_MAX}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Write a caption…"
              className="min-h-[96px] resize-none text-[15px]"
              aria-label="Caption"
            />
            <div className="mt-1 text-right text-[11px] text-muted-foreground">
              {caption.length}/{CAPTION_MAX}
            </div>
          </div>
          <AudiencePicker value={visibility} onChange={setVisibility} hideLoads={hideLoads} onHideLoads={setHideLoads} />
        </div>
        <div className="border-t border-border/60 px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-3">
          <Button type="button" className="h-12 w-full rounded-2xl text-[15px] font-black" disabled={edit.isPending} onClick={() => void save()}>
            {edit.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
