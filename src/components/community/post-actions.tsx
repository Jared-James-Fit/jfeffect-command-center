import { useState } from "react";
import { Archive, ArchiveRestore, EyeOff, Flag, MoreHorizontal, Pencil, Trash2, UserX } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { NoteEditor } from "@/components/community/note-editor";
import { EditPostSheet } from "@/components/community/edit-post-sheet";
import type { CommunityPost } from "@/lib/community";
import { useArchivePost, useBlockUser, useDeletePost, useHidePost, useUpdateNote } from "@/lib/community.queries";
import { ReportSheet } from "@/components/community/report-sheet";

/**
 * The "…" on a post, Instagram-style. Your own post: Edit, Archive (only you
 * see it, in Archived on your profile, until you restore it) or Delete.
 * Coaches can also remove anyone's post and edit coach notes. Someone else's
 * post: Report, Hide, or Block the person.
 * `onGone` runs after an archive or delete (e.g. to close the detail view).
 */
export function PostActions({ post, viewerIsStaff, onGone, className }: { post: CommunityPost; viewerIsStaff: boolean; onGone?: () => void; className?: string }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const del = useDeletePost();
  const hide = useHidePost();
  const block = useBlockUser();
  const archive = useArchivePost();
  const updateNote = useUpdateNote();

  const mine = post.is_mine;
  const isNote = post.kind === "note";
  const archived = !!post.archived_at;
  const canEdit = mine || (isNote && viewerIsStaff);
  const canDelete = mine || viewerIsStaff;
  const canReport = !mine;

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
          {canReport && (
            <>
              <DropdownMenuItem onSelect={() => setReporting(true)}>
                <Flag className="mr-2 h-4 w-4" /> Report
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  hide.mutate(post.id, {
                    onSuccess: () => { toast.success("Hidden. You won't see this post again."); onGone?.(); },
                    onError: (e: any) => toast.error(e?.message ?? "Couldn't hide that"),
                  })
                }
              >
                <EyeOff className="mr-2 h-4 w-4" /> Hide post
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirmBlock(true)}>
                <UserX className="mr-2 h-4 w-4" /> Block {post.author.name}
              </DropdownMenuItem>
              {(canEdit || canDelete) && <DropdownMenuSeparator />}
            </>
          )}
          {canEdit && (
            <DropdownMenuItem onSelect={() => setEditing(true)}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </DropdownMenuItem>
          )}
          {mine && (
            <DropdownMenuItem onSelect={() => setArchived(!archived)} disabled={archive.isPending}>
              {archived ? <ArchiveRestore className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}
              {archived ? "Show on profile" : "Archive"}
            </DropdownMenuItem>
          )}
          {canDelete && (
            <>
              {canEdit && <DropdownMenuSeparator />}
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirmDelete(true)}>
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

      <ReportSheet target={reporting ? { postId: post.id } : null} onClose={() => setReporting(false)} />

      <AlertDialog open={confirmBlock} onOpenChange={setConfirmBlock}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Block {post.author.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              You won't see their posts or comments, and they won't see yours. They aren't told. You can unblock them from your community profile.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                block.mutate(
                  { userId: post.author.user_id, block: true },
                  {
                    onSuccess: () => { toast.success(`${post.author.name} is blocked`); onGone?.(); },
                    onError: (e: any) => toast.error(e?.message ?? "Couldn't block"),
                  },
                )
              }
            >
              Block
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
          saving={updateNote.isPending}
          onClose={() => setEditing(false)}
          onSave={async (body) => {
            await updateNote.mutateAsync({ postId: post.id, body });
            toast.success("Post updated");
          }}
        />
      ) : (
        <EditPostSheet post={editing ? post : null} onClose={() => setEditing(false)} />
      )}
    </>
  );
}
