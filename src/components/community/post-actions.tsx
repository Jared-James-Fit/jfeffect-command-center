import { useState } from "react";
import { Archive, ArchiveRestore, Instagram, MoreHorizontal, Pencil, Sticker, Trash2, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { NoteEditor } from "@/components/community/note-editor";
import { attachOfPost } from "@/components/community/post-attach";
import { EditPostSheet } from "@/components/community/edit-post-sheet";
import { PREVIEW_ONLY_MESSAGE, type CommunityPost } from "@/lib/community";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { useArchivePost, useDeletePost, useLeavePost, useMyCommunityId, useRemoveNoteScene, useSetPostMedia, useUpdateNote } from "@/lib/community.queries";
import { extraScene, postSlides } from "@/lib/community";
import { isSpiritScene } from "@/components/community/spirit-scenes";
import { PostStickerEditor } from "@/components/community/sticker-editor";
import { InstagramShareSheet } from "@/components/community/instagram-share-sheet";

/**
 * The "…" on a post, Instagram-style. Your own post: Edit, Archive (only you
 * see it, in Archived on your profile, until you restore it) or Delete.
 * Coaches can also remove anyone's post and edit coach notes.
 * Named on someone else's post: Remove me (off the post and your profile).
 * Coaches, on any post: Share to Instagram (never in View as client).
 * `onGone` runs after an archive or delete (e.g. to close the detail view).
 */
export function PostActions({ post, viewerIsStaff, onGone, className }: { post: CommunityPost; viewerIsStaff: boolean; onGone?: () => void; className?: string }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sticker, setSticker] = useState(false);
  // mounted on first open (a feed of posts never runs it for nothing), kept for its closing slide
  const [ig, setIg] = useState<boolean | null>(null);
  const del = useDeletePost();
  const archive = useArchivePost();
  const updateNote = useUpdateNote();
  const setMedia = useSetPostMedia();
  const removeScene = useRemoveNoteScene();
  // Saturday's drawn scene (only while there's no photo: a photo is the cover)
  const drawn = post.series === "saturday_spirit" && !post.media_type ? extraScene(post.series_extra) : null;
  const sceneKey = drawn && isSpiritScene(drawn) ? drawn : null;
  const leave = useLeavePost();
  const me = useMyCommunityId();
  // a coach viewing as a client sees the client's menu, but nothing in it acts as them
  const { isImpersonating } = useClientImpersonation();
  const act = (fn: () => void) => () => (isImpersonating ? void toast.message(PREVIEW_ONLY_MESSAGE) : fn());

  const mine = post.is_mine;
  const isNote = post.kind === "note";
  const archived = !!post.archived_at;
  const canEdit = mine || (isNote && viewerIsStaff);
  const canDelete = mine || viewerIsStaff;
  const onIt = !mine && !!me && (post.mentions ?? []).some((m) => m.user_id === me);
  const canInstagram = viewerIsStaff && !isImpersonating && !post.story;
  if (!canEdit && !canDelete && !onIt && !canInstagram) return null;

  const setArchived = (on: boolean) =>
    archive.mutate(
      { postId: post.id, archive: on },
      {
        onSuccess: () => {
          if (on) {
            toast.success("Archived. Only you can see it now.", {
              description: "Find it in Archived on your profile.",
              action: { label: "Undo", onClick: () => archive.mutate({ postId: post.id, archive: false }) },
            });
            onGone?.();
          } else toast.success("Restored to your profile");
        },
        onError: (e: any) => toast.error(e?.message ?? "Couldn't do that"),
      },
    );

  const remove = () =>
    del.mutate(post, {
      onSuccess: () => {
        toast.success(mine ? "Post deleted" : "Post removed");
        onGone?.();
      },
      onError: (e: any) => toast.error(e?.message ?? "Couldn't remove that post"),
    });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={className ?? "grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"} aria-label="Post options">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          {canInstagram && (
            <>
              <DropdownMenuItem onSelect={act(() => setIg(true))} data-share-instagram>
                <Instagram className="mr-2 h-4 w-4" /> Share to Instagram
              </DropdownMenuItem>
              {(onIt || canEdit || canDelete) && <DropdownMenuSeparator />}
            </>
          )}
          {onIt && (
            <DropdownMenuItem
              disabled={leave.isPending}
              onSelect={act(() =>
                leave.mutate(post.id, {
                  onSuccess: () => toast.success("You're off this post", { description: "It's no longer on your profile." }),
                  onError: (e: any) => toast.error(e?.message ?? "Couldn't do that"),
                }),
              )}
            >
              <UserMinus className="mr-2 h-4 w-4" /> Remove me from this post
            </DropdownMenuItem>
          )}
          {canEdit && (
            <DropdownMenuItem onSelect={act(() => setEditing(true))}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </DropdownMenuItem>
          )}
          {mine && post.visibility === "community" && !archived && (
            <DropdownMenuItem onSelect={act(() => setSticker(true))}>
              <Sticker className="mr-2 h-4 w-4" /> {post.sticker ? "Story sticker" : "Add a story sticker"}
            </DropdownMenuItem>
          )}
          {mine && (
            <DropdownMenuItem onSelect={act(() => setArchived(!archived))} disabled={archive.isPending}>
              {archived ? <ArchiveRestore className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}
              {archived ? "Show on profile" : "Archive"}
            </DropdownMenuItem>
          )}
          {canDelete && (
            <>
              {canEdit && <DropdownMenuSeparator />}
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={act(() => setConfirmDelete(true))}>
                <Trash2 className="mr-2 h-4 w-4" /> {mine ? "Delete" : "Remove post"}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{mine ? "Delete this post?" : "Remove this post?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {mine
                ? `It's gone for good, fire and comments too.${isNote ? "" : " Your workout itself isn't touched."}${archived ? "" : " You can archive it instead to just hide it."}`
                : isNote
                  ? "It disappears from the community for everyone."
                  : "It disappears from the community for everyone. The athlete's workout isn't touched."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            {mine && !archived && (
              <AlertDialogAction className="bg-secondary text-secondary-foreground hover:bg-secondary/80" onClick={() => setArchived(true)}>
                Archive instead
              </AlertDialogAction>
            )}
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={remove}>
              {mine ? "Delete" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isNote ? (
        <NoteEditor
          open={editing}
          title="Edit post"
          initial={post.caption ?? ""}
          quote={post.quote ? { text: post.quote, author: post.quote_author ?? null } : null}
          saving={updateNote.isPending || setMedia.isPending || removeScene.isPending}
          onClose={() => setEditing(false)}
          media={{ initial: postSlides(post), key: post.id }}
          scene={sceneKey ? { key: sceneKey, onRemove: () => removeScene.mutateAsync(post.id) } : undefined}
          // a GIF / voice memo is the author's own (staff can fix the words of anyone's note)
          attach={mine ? { initial: attachOfPost(post), key: post.id } : undefined}
          // a member's photo post can lose its words; a coach's text post can't
          wordsOptional={!post.author.is_coach}
          onSave={async (body, _poll, media) => {
            await updateNote.mutateAsync({ postId: post.id, body });
            if (media) await setMedia.mutateAsync({ postId: post.id, media });
            toast.success("Post updated");
            return post.id;
          }}
        />
      ) : (
        <EditPostSheet post={editing ? post : null} onClose={() => setEditing(false)} />
      )}
      {mine && <PostStickerEditor post={post} open={sticker} onClose={() => setSticker(false)} />}
      {canInstagram && ig !== null && <InstagramShareSheet post={post} open={ig} onOpenChange={setIg} />}
    </>
  );
}
