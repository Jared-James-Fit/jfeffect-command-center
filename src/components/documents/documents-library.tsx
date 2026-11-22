/**
 * One documents library (src/lib/documents): a person's own (Account →
 * Documents), a coach's view of a client (the client's Documents tab) and a
 * staff member's own (/admin/documents). One list with a search, category
 * chips (only the ones in use), a sort, and rows that open the file; the ⋯
 * renames, recategorizes, retags, re-shares, downloads or deletes (Undo, and
 * 30 days in Recently deleted). Upload is the one main button; in View as
 * client nothing changes anything.
 */
import { useMemo, useRef, useState } from "react";
import { ChevronRight, FolderOpen, Search, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CardMenu, CardMenuItem, CardMenuSeparator } from "@/components/workout-day/card-menu";
import { cn } from "@/lib/utils";
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_SORTS,
  canEditDocument,
  categoryChips,
  checkFile,
  filterDocuments,
  isDocumentSort,
  metaLine,
  shareWords,
  sortDocuments,
  visibilityOptions,
  type DocumentCategory,
  type DocumentRow,
  type DocumentSort,
  type LibraryScope,
} from "@/lib/documents/documents";
import {
  useDeletedDocuments,
  useDocumentDownload,
  useDocumentWrites,
  useDocuments,
  type LibraryTarget,
} from "@/lib/documents/documents-queries";
import {
  DocumentPreviewSheet,
  EditDocumentSheet,
  FileTile,
  RecentlyDeletedSheet,
  UploadDocumentSheet,
  type EditFocus,
} from "./document-sheets";

const PREVIEW_MESSAGE = "Preview only: this is how it looks to them.";

export interface DocumentsLibraryProps {
  target: LibraryTarget | null;
  scope: LibraryScope;
  /** The signed-in login: who uploads, and who may change a document. */
  userId: string | null | undefined;
  /** Who the list reads as (View as client: the client's login). Defaults to userId. */
  viewerId?: string | null;
  /** A coaching client (their coach is a choice for who sees it). */
  hasCoach?: boolean;
  clientFirstName?: string | null;
  clientUserId?: string | null;
  /** View as client: look, never change. */
  preview?: boolean;
  className?: string;
}

function emptyLine(scope: LibraryScope, hasCoach?: boolean, first?: string | null): string {
  if (scope === "client") {
    const name = first?.trim() || "this client";
    return `Programs, plans and notes for ${name}. You choose whether ${first?.trim() || "they"} can see each one.`;
  }
  if (scope === "staff") return "Your own files and templates. Only you can see them.";
  return hasCoach
    ? "Keep a program, a meal plan or anything you want on hand. Your coach can share files with you here too."
    : "Keep a program, a meal plan or anything you want on hand. Only you can see them.";
}

export function DocumentsLibrary({
  target,
  scope,
  userId,
  viewerId,
  hasCoach,
  clientFirstName,
  clientUserId,
  preview = false,
  className,
}: DocumentsLibraryProps) {
  const reader = viewerId ?? userId ?? null;
  const list = useDocuments(target);
  const deleted = useDeletedDocuments(preview ? null : target, userId);
  const writes = useDocumentWrites();
  const download = useDocumentDownload();

  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<DocumentCategory | "all">("all");
  const [sort, setSort] = useState<DocumentSort>("newest");
  const [open, setOpen] = useState<DocumentRow | null>(null);
  const [editing, setEditing] = useState<{ doc: DocumentRow; focus: EditFocus } | null>(null);
  const [binOpen, setBinOpen] = useState(false);

  const docs = useMemo(() => list.data ?? [], [list.data]);
  const chips = useMemo(() => categoryChips(docs, category), [docs, category]);
  const shown = useMemo(
    () => sortDocuments(filterDocuments(docs, { category, query }), sort),
    [docs, category, query, sort],
  );
  const bin = deleted.data ?? [];
  const options = visibilityOptions(scope, { hasCoach, clientFirstName });

  const viewer = { userId: reader, scope, clientUserId, clientFirstName };
  const shareFor = (d: DocumentRow) => shareWords(d, viewer);

  // the picker opens inside the tap (a phone opens it only from one)
  const pick = () => {
    if (preview) return void toast(PREVIEW_MESSAGE);
    input.current?.click();
  };
  const onPicked = (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    const check = checkFile(file);
    if (!check.ok) return void toast.error(check.message);
    setPicked(file);
  };

  const upload = async (details: {
    title: string;
    category: DocumentCategory;
    tags: string[];
    visibility: DocumentRow["visibility"];
  }) => {
    if (!picked || !userId) return false;
    const res = await writes.upload(userId, {
      file: picked,
      ...details,
      scope,
      clientId: target?.scope === "client" ? target.clientId : null,
    });
    if (!res.ok) {
      toast.error(res.message);
      return false;
    }
    toast.success(`Added "${res.document.title}"`);
    return true;
  };

  const editable = (d: DocumentRow) => !preview && canEditDocument(d, userId);
  const startEdit = (doc: DocumentRow, focus: EditFocus) => setEditing({ doc, focus });

  return (
    <div className={cn("space-y-3", className)} data-documents-library={scope}>
      <input
        ref={input}
        type="file"
        accept={DOCUMENT_ACCEPT}
        className="hidden"
        onChange={(e) => onPicked(e.target.files?.[0])}
        data-documents-input
      />

      {list.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-11 w-full rounded-lg" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <Skeleton className="h-11 w-11 rounded-xl" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : list.isError ? (
        <div className="rounded-xl border border-border p-4 text-sm">
          <div className="font-semibold">Couldn't load your documents</div>
          <div className="mt-0.5 text-muted-foreground">Check your connection and try again.</div>
          <Button variant="outline" className="mt-3 h-10" onClick={() => void list.refetch()}>
            Try again
          </Button>
        </div>
      ) : docs.length === 0 ? (
        <div
          className="rounded-2xl border border-dashed border-border px-6 py-10 text-center"
          data-documents-empty
        >
          <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <div className="mt-3 text-base font-semibold">No documents yet</div>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            {emptyLine(scope, hasCoach, clientFirstName)}
          </p>
          {!preview && (
            <Button className="mt-4 h-11" onClick={pick}>
              <Upload className="mr-2 h-4 w-4" />
              Upload
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search names and tags"
                className="h-11 pl-9 pr-10 text-base"
                inputMode="search"
                aria-label="Search documents"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {!preview && (
              <Button className="h-11 shrink-0" onClick={pick} data-documents-upload>
                <Upload className="mr-1.5 h-4 w-4" />
                Upload
              </Button>
            )}
          </div>

          {chips.length > 1 && (
            <div
              role="group"
              aria-label="Category"
              className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]"
            >
              <CategoryChip on={category === "all"} onClick={() => setCategory("all")}>
                All
              </CategoryChip>
              {chips.map((c) => (
                <CategoryChip
                  key={c.value}
                  on={category === c.value}
                  onClick={() => setCategory(category === c.value ? "all" : c.value)}
                >
                  {c.label}
                </CategoryChip>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 text-[13px] text-muted-foreground">
            <span>
              {shown.length === docs.length ? docs.length : `${shown.length} of ${docs.length}`}{" "}
              {docs.length === 1 ? "document" : "documents"}
            </span>
            <Select value={sort} onValueChange={(v) => isDocumentSort(v) && setSort(v)}>
              <SelectTrigger
                className="h-9 w-auto gap-1.5 border-0 bg-transparent px-2 text-[13px] text-muted-foreground shadow-none"
                aria-label="Sort"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {DOCUMENT_SORTS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {shown.length === 0 ? (
            <div className="space-y-3 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              <div>No documents match.</div>
              <Button
                variant="outline"
                className="h-10"
                onClick={() => {
                  setQuery("");
                  setCategory("all");
                }}
              >
                Show every document
              </Button>
            </div>
          ) : (
            <ul className="-mx-1" data-documents-list>
              {shown.map((d) => (
                <li key={d.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setOpen(d)}
                    className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-2 text-left transition-colors hover:bg-muted/40 active:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-document-row={d.id}
                  >
                    <FileTile mime={d.mime} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{d.title}</span>
                      <span className="block truncate text-[13px] text-muted-foreground">
                        {[metaLine(d), shareFor(d)].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </button>
                  <CardMenu
                    name={d.title}
                    buttonClassName="h-10 w-10 shrink-0 rounded-full p-0 text-muted-foreground"
                    ariaLabel={`More for ${d.title}`}
                    align="end"
                    description="Options for this document"
                  >
                    {editable(d) && (
                      <>
                        <CardMenuItem onSelect={() => startEdit(d, "title")}>Rename</CardMenuItem>
                        <CardMenuItem onSelect={() => startEdit(d, "category")}>
                          Category
                        </CardMenuItem>
                        <CardMenuItem onSelect={() => startEdit(d, "tags")}>Tags</CardMenuItem>
                        {(options.length > 1 || d.visibility !== options[0]?.value) && (
                          <CardMenuItem onSelect={() => startEdit(d, "visibility")}>
                            Who can see it
                          </CardMenuItem>
                        )}
                        <CardMenuSeparator />
                      </>
                    )}
                    <CardMenuItem onSelect={() => void download(d)}>Download</CardMenuItem>
                    {editable(d) && (
                      <>
                        <CardMenuSeparator />
                        <CardMenuItem
                          onSelect={() => void writes.remove(d)}
                          className="text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </CardMenuItem>
                      </>
                    )}
                  </CardMenu>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {!preview && bin.length > 0 && (
        <button
          type="button"
          onClick={() => setBinOpen(true)}
          className="flex min-h-12 w-full items-center gap-3 rounded-xl px-1 text-left text-[15px] text-muted-foreground transition-colors hover:bg-muted/40 active:bg-muted/60"
          data-documents-bin-row
        >
          <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
          <span className="flex-1">Recently deleted</span>
          <span className="text-[13px]">{bin.length}</span>
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
        </button>
      )}

      <UploadDocumentSheet
        file={picked}
        scope={scope}
        hasCoach={hasCoach}
        clientFirstName={clientFirstName}
        onPickAnother={pick}
        onClose={() => setPicked(null)}
        onUpload={upload}
      />
      <DocumentPreviewSheet
        doc={open}
        shareLine={open ? shareFor(open) : null}
        onClose={() => setOpen(null)}
      />
      <EditDocumentSheet
        doc={editing?.doc ?? null}
        focus={editing?.focus ?? "title"}
        scope={scope}
        hasCoach={hasCoach}
        clientFirstName={clientFirstName}
        onClose={() => setEditing(null)}
        onSave={async (patch) => {
          if (!editing) return false;
          const res = await writes.save(editing.doc.id, patch);
          if (!res.ok) {
            toast.error(res.message);
            return false;
          }
          return true;
        }}
      />
      <RecentlyDeletedSheet
        open={binOpen}
        docs={bin}
        onClose={() => setBinOpen(false)}
        onRestore={async (d) => {
          const res = await writes.restore(d.id);
          if (!res.ok) toast.error(res.message);
          return res.ok;
        }}
      />
    </div>
  );
}

function CategoryChip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "h-10 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition",
        on
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
