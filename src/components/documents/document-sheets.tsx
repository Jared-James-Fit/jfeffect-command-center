/**
 * The documents library's sheets: upload, open (preview), edit details and
 * Recently deleted. Bottom sheets with a grip that swipe down to close.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Download,
  ExternalLink,
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  RIGHTS_TEXT,
  binLine,
  categoriesFor,
  cleanTitle,
  fileTypeOf,
  formatBytes,
  guessCategory,
  kindOfMime,
  metaLine,
  parseTagInput,
  titleFromFileName,
  uploadPrivacyLine,
  visibilityOptions,
  type DocumentCategory,
  type DocumentRow,
  type DocumentVisibility,
  type FileKind,
  type LibraryScope,
} from "@/lib/documents/documents";
import {
  fetchDocumentFile,
  useDocumentDownload,
  useDocumentLink,
} from "@/lib/documents/documents-queries";

/* ───────────────────────── shared bits ───────────────────────── */

const SHEET =
  "mx-auto max-h-[92dvh] max-w-xl overflow-y-auto overscroll-contain rounded-t-2xl px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] pt-2";

function Grip() {
  return <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />;
}

export function FileKindIcon({ kind, className }: { kind: FileKind; className?: string }) {
  const Icon =
    kind === "image"
      ? FileImage
      : kind === "sheet" || kind === "csv"
        ? FileSpreadsheet
        : kind === "pdf" || kind === "word" || kind === "text"
          ? FileText
          : FileIcon;
  return <Icon className={className} aria-hidden />;
}

export function FileTile({ mime, className }: { mime: string; className?: string }) {
  return (
    <span
      className={cn(
        "grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground",
        className,
      )}
    >
      <FileKindIcon kind={kindOfMime(mime)} className="h-5 w-5" />
    </span>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "h-10 shrink-0 rounded-full border px-4 text-sm font-medium transition",
        on
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium">
      {children}
    </label>
  );
}

function CategoryPicker({
  scope,
  value,
  onChange,
}: {
  scope: LibraryScope;
  value: DocumentCategory;
  onChange: (c: DocumentCategory) => void;
}) {
  const options = categoriesFor(scope);
  // a category this library doesn't offer (a coach used it) still shows while it's the one set
  const shown = options.some((o) => o.value === value)
    ? options
    : [...options, { value, label: value.replace(/_/g, " ") }];
  return (
    <div role="group" aria-label="Category" className="flex flex-wrap gap-1.5">
      {shown.map((c) => (
        <Chip key={c.value} on={value === c.value} onClick={() => onChange(c.value)}>
          {c.label}
        </Chip>
      ))}
    </div>
  );
}

function VisibilityPicker({
  options,
  value,
  onChange,
}: {
  options: { value: DocumentVisibility; label: string; hint: string }[];
  value: DocumentVisibility;
  onChange: (v: DocumentVisibility) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Who can see it"
      className="overflow-hidden rounded-xl border border-border"
    >
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-muted",
            i > 0 && "border-t border-border",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "grid h-5 w-5 shrink-0 place-items-center rounded-full border",
              value === o.value ? "border-foreground" : "border-muted-foreground/50",
            )}
          >
            {value === o.value && <span className="h-2.5 w-2.5 rounded-full bg-foreground" />}
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-medium">{o.label}</span>
            <span className="block text-[13px] text-muted-foreground">{o.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/* ───────────────────────── upload ───────────────────────── */

export interface UploadDetails {
  title: string;
  category: DocumentCategory;
  tags: string[];
  visibility: DocumentVisibility;
}

/**
 * The details of a file just picked: its name, category, tags, who can see
 * it, and the rights confirmation (unticked every time). Upload is the one
 * main button; anything missing is said under it, never a greyed-out button.
 */
export function UploadDocumentSheet({
  file,
  scope,
  hasCoach,
  clientFirstName,
  onPickAnother,
  onClose,
  onUpload,
}: {
  file: File | null;
  scope: LibraryScope;
  hasCoach?: boolean;
  clientFirstName?: string | null;
  onPickAnother: () => void;
  onClose: () => void;
  onUpload: (details: UploadDetails) => Promise<boolean>;
}) {
  const options = useMemo(
    () => visibilityOptions(scope, { hasCoach, clientFirstName }),
    [scope, hasCoach, clientFirstName],
  );
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<DocumentCategory>("other");
  const [tags, setTags] = useState("");
  const [visibility, setVisibility] = useState<DocumentVisibility>(options[0].value);
  const [rights, setRights] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // a new file: its own name and a guess at its category; the rights box starts unticked
  useEffect(() => {
    if (!file) return;
    setTitle(titleFromFileName(file.name));
    setCategory(guessCategory(file.name, scope));
    setRights(false);
    setProblem(null);
  }, [file, scope]);
  useEffect(() => setVisibility(options[0].value), [options]);

  const submit = async () => {
    if (busy) return;
    const name = cleanTitle(title);
    if (!name) return setProblem("Give it a name.");
    if (!rights) return setProblem("Tick the box to confirm you can upload it.");
    setProblem(null);
    setBusy(true);
    const ok = await onUpload({ title: name, category, tags: parseTagInput(tags), visibility });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Sheet open={!!file} onOpenChange={(o) => !o && !busy && onClose()}>
      <SheetContent
        side="bottom"
        hideCloseButton
        swipeToClose
        className={SHEET}
        data-document-upload
      >
        <Grip />
        <SheetTitle className="text-base font-semibold">Add a document</SheetTitle>
        <SheetDescription className="sr-only">
          Name it, pick a category and who can see it, then upload.
        </SheetDescription>
        {file && (
          <div className="mt-3 space-y-5">
            <div className="flex items-center gap-3 rounded-xl border border-border p-3">
              <FileTile mime={fileTypeOf(file.name, file.type)?.mime ?? file.type} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-medium">{file.name}</div>
                <div className="text-[13px] text-muted-foreground">{formatBytes(file.size)}</div>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="h-10 shrink-0"
                onClick={onPickAnother}
                disabled={busy}
              >
                Change
              </Button>
            </div>

            <div>
              <FieldLabel htmlFor="document-title">Name</FieldLabel>
              <Input
                id="document-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                className="h-12 text-base"
              />
            </div>

            <div>
              <FieldLabel>Category</FieldLabel>
              <CategoryPicker scope={scope} value={category} onChange={setCategory} />
            </div>

            <div>
              <FieldLabel htmlFor="document-tags">Tags (optional)</FieldLabel>
              <Input
                id="document-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="meet prep, peak"
                className="h-12 text-base"
                autoCapitalize="none"
              />
            </div>

            {options.length > 1 && (
              <div>
                <FieldLabel>Who can see it</FieldLabel>
                <VisibilityPicker options={options} value={visibility} onChange={setVisibility} />
              </div>
            )}

            <p className="text-[13px] text-muted-foreground" data-document-privacy>
              {uploadPrivacyLine(visibility, scope, clientFirstName)}
            </p>

            <label
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3"
              data-document-rights
            >
              <Checkbox
                checked={rights}
                onCheckedChange={(v) => setRights(v === true)}
                className="mt-0.5 h-5 w-5"
                aria-label="Confirm you can upload it"
              />
              <span className="text-[14px] leading-snug">{RIGHTS_TEXT}</span>
            </label>

            <div className="space-y-2">
              {problem && (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {problem}
                </p>
              )}
              <Button
                type="button"
                className="h-12 w-full text-base"
                onClick={() => void submit()}
                disabled={busy}
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading…
                  </>
                ) : (
                  "Upload"
                )}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ───────────────────────── open (preview) ───────────────────────── */

/** Fetch the file ahead for Download only when it's small (the share sheet needs the bytes inside the tap). */
const HOLD_UP_TO = 8 * 1024 * 1024;

export function DocumentPreviewSheet({
  doc,
  shareLine,
  onClose,
}: {
  doc: DocumentRow | null;
  shareLine?: string | null;
  onClose: () => void;
}) {
  const kind = doc ? kindOfMime(doc.mime) : "text";
  const link = useDocumentLink(doc?.id ?? null, { enabled: !!doc });
  const download = useDocumentDownload();
  const [held, setHeld] = useState<File | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const heldFor = useRef<string | null>(null);

  useEffect(() => {
    setHeld(null);
    setImgFailed(false);
    heldFor.current = doc?.id ?? null;
  }, [doc?.id]);

  // small files are fetched while the sheet is open, so Download hands them over in the tap itself
  useEffect(() => {
    const res = link.data;
    if (!doc || !res || doc.bytes > HOLD_UP_TO) return;
    const id = doc.id;
    let cancelled = false;
    fetchDocumentFile(res.url, res.name, res.mime)
      .then((f) => {
        if (!cancelled && heldFor.current === id) setHeld(f);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, doc?.bytes, link.data]);

  const save = async () => {
    if (!doc || saving) return;
    setSaving(true);
    await download(doc, held);
    setSaving(false);
  };

  return (
    <Sheet open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        hideCloseButton
        swipeToClose
        className={SHEET}
        data-document-preview
      >
        <Grip />
        {doc && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <FileTile mime={doc.mime} />
              <div className="min-w-0 flex-1">
                <SheetTitle className="break-words text-base font-semibold leading-snug">
                  {doc.title}
                </SheetTitle>
                <SheetDescription className="text-[13px] text-muted-foreground">
                  {[metaLine(doc), shareLine].filter(Boolean).join(" · ")}
                </SheetDescription>
                {doc.tags.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {doc.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-muted px-2 py-0.5 text-[12px] text-muted-foreground"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-muted/40">
              {link.isLoading ? (
                <Skeleton className="h-[50dvh] w-full rounded-none" />
              ) : link.isError || !link.data ? (
                <div className="grid h-40 place-items-center p-4 text-center text-sm">
                  <div>
                    <div className="font-medium">Couldn't open it</div>
                    <Button
                      variant="outline"
                      className="mt-3 h-10"
                      onClick={() => void link.refetch()}
                    >
                      Try again
                    </Button>
                  </div>
                </div>
              ) : kind === "image" && !imgFailed ? (
                <img
                  src={link.data.url}
                  alt={doc.title}
                  className="mx-auto max-h-[60dvh] w-full object-contain"
                  onError={() => setImgFailed(true)}
                />
              ) : kind === "pdf" ? (
                <iframe
                  src={link.data.url}
                  title={doc.title}
                  className="h-[60dvh] w-full bg-background"
                />
              ) : (
                <div className="grid h-40 place-items-center p-4 text-center">
                  <div>
                    <FileKindIcon kind={kind} className="mx-auto h-8 w-8 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      Download it to open it in another app.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              {kind === "pdf" && link.data && (
                <Button asChild variant="outline" className="h-12 flex-1 text-base">
                  <a href={link.data.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open
                  </a>
                </Button>
              )}
              <Button
                type="button"
                className="h-12 flex-1 text-base"
                onClick={() => void save()}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Download
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ───────────────────────── edit details ───────────────────────── */

export type EditFocus = "title" | "category" | "tags" | "visibility";

export function EditDocumentSheet({
  doc,
  focus,
  scope,
  hasCoach,
  clientFirstName,
  onClose,
  onSave,
}: {
  doc: DocumentRow | null;
  focus: EditFocus;
  scope: LibraryScope;
  hasCoach?: boolean;
  clientFirstName?: string | null;
  onClose: () => void;
  onSave: (patch: UploadDetails) => Promise<boolean>;
}) {
  const options = useMemo(
    () => visibilityOptions(scope, { hasCoach, clientFirstName }),
    [scope, hasCoach, clientFirstName],
  );
  // a setting no longer offered (a member who left coaching) stays a choice while it's the one set
  const shownOptions = useMemo(() => {
    if (!doc || options.some((o) => o.value === doc.visibility)) return options;
    const all = visibilityOptions("client", { clientFirstName });
    const kept = all.find((o) => o.value === doc.visibility) ?? {
      value: doc.visibility,
      label: doc.visibility,
      hint: "",
    };
    return [...options, kept];
  }, [doc, options, clientFirstName]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<DocumentCategory>("other");
  const [tags, setTags] = useState("");
  const [visibility, setVisibility] = useState<DocumentVisibility>("private");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sections = useRef<Partial<Record<EditFocus, HTMLDivElement | null>>>({});

  useEffect(() => {
    if (!doc) return;
    setTitle(doc.title);
    setCategory(doc.category);
    setTags(doc.tags.join(", "));
    setVisibility(doc.visibility);
    setProblem(null);
  }, [doc]);

  useEffect(() => {
    if (!doc || focus === "title") return;
    const t = window.setTimeout(
      () => sections.current[focus]?.scrollIntoView({ block: "center", behavior: "smooth" }),
      250,
    );
    return () => window.clearTimeout(t);
  }, [doc, focus]);

  const submit = async () => {
    if (busy) return;
    const name = cleanTitle(title);
    if (!name) return setProblem("Give it a name.");
    setProblem(null);
    setBusy(true);
    const ok = await onSave({ title: name, category, tags: parseTagInput(tags), visibility });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Sheet open={!!doc} onOpenChange={(o) => !o && !busy && onClose()}>
      <SheetContent side="bottom" hideCloseButton swipeToClose className={SHEET} data-document-edit>
        <Grip />
        <SheetTitle className="text-base font-semibold">Edit details</SheetTitle>
        <SheetDescription className="sr-only">
          Change the name, category, tags or who can see it.
        </SheetDescription>
        {doc && (
          <div className="mt-3 space-y-5">
            <div
              ref={(el) => {
                sections.current.title = el;
              }}
            >
              <FieldLabel htmlFor="document-edit-title">Name</FieldLabel>
              <Input
                id="document-edit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                className="h-12 text-base"
                autoFocus={focus === "title"}
              />
            </div>
            <div
              ref={(el) => {
                sections.current.category = el;
              }}
            >
              <FieldLabel>Category</FieldLabel>
              <CategoryPicker scope={scope} value={category} onChange={setCategory} />
            </div>
            <div
              ref={(el) => {
                sections.current.tags = el;
              }}
            >
              <FieldLabel htmlFor="document-edit-tags">Tags</FieldLabel>
              <Input
                id="document-edit-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="meet prep, peak"
                className="h-12 text-base"
                autoCapitalize="none"
                autoFocus={focus === "tags"}
              />
            </div>
            {shownOptions.length > 1 && (
              <div
                ref={(el) => {
                  sections.current.visibility = el;
                }}
              >
                <FieldLabel>Who can see it</FieldLabel>
                <VisibilityPicker
                  options={shownOptions}
                  value={visibility}
                  onChange={setVisibility}
                />
              </div>
            )}
            <div className="space-y-2">
              {problem && (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {problem}
                </p>
              )}
              <Button
                type="button"
                className="h-12 w-full text-base"
                onClick={() => void submit()}
                disabled={busy}
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ───────────────────────── Recently deleted ───────────────────────── */

export function RecentlyDeletedSheet({
  open,
  docs,
  onClose,
  onRestore,
}: {
  open: boolean;
  docs: DocumentRow[];
  onClose: () => void;
  onRestore: (doc: DocumentRow) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const restore = async (doc: DocumentRow) => {
    setBusy(doc.id);
    const ok = await onRestore(doc);
    setBusy(null);
    if (ok) toast.success(`Restored "${doc.title}"`);
  };
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideCloseButton swipeToClose className={SHEET} data-documents-bin>
        <Grip />
        <SheetTitle className="text-base font-semibold">Recently deleted</SheetTitle>
        <SheetDescription className="text-[13px] text-muted-foreground">
          Deleted documents stay here for 30 days, then they're gone for good.
        </SheetDescription>
        <div className="mt-3 divide-y divide-border">
          {docs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing here.</p>
          ) : (
            docs.map((d) => (
              <div key={d.id} className="flex items-center gap-3 py-3">
                <FileTile mime={d.mime} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{d.title}</div>
                  <div className="text-[13px] text-muted-foreground">
                    {d.deleted_at ? binLine(d.deleted_at) : ""}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0"
                  onClick={() => void restore(d)}
                  disabled={busy === d.id}
                >
                  {busy === d.id ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-1.5 h-4 w-4" />
                  )}
                  Restore
                </Button>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
