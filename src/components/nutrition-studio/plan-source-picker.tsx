/**
 * Bring a meal plan in: paste it, or pick a file (a spreadsheet, a Word
 * document, a text file, a PDF or 1–8 photos). Spreadsheets, documents and
 * text are read on the phone with the program importer's reader
 * (program-import/extract.ts) and their original is kept privately for the
 * person's documents; a PDF or photos are uploaded privately for a full read.
 * Before anything is read the person ticks the rights confirmation (its exact
 * words are stored with the import). One engine for a member's Studio and a
 * coach's plan editor; only a member's full read costs credits.
 */
import { useRef, useState } from "react";
import { FileSpreadsheet, FileText, Image as ImageIcon, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AiCreditsChip, AiCreditsSheet, useAiCredits, useSetCreditState } from "@/components/ai-credits/ai-credits";
import { FEATURE_COSTS } from "@/lib/ai-credits/packs";
import { startMealPlanImport, type StartImportResult } from "@/lib/nutrition-import/import.functions";
import { MEAL_IMPORT_PRIVACY_TEXT, MEAL_IMPORT_RIGHTS_EXPLAINER, rightsTextFor } from "@/lib/nutrition-import/rights";
import type { MealImportResult } from "@/lib/nutrition-import/types";
import type { SourceDoc } from "@/lib/program-import/types";

const COST = FEATURE_COSTS.nutrition_import;
const BUCKET = "nutrition-imports";
const MAX_LOCAL_BYTES = 15 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_PHOTOS = 8;
const MAX_SEND_TEXT = 100_000;
const ACCEPT =
  ".xlsx,.xlsm,.xls,.csv,.tsv,.docx,.pdf,.txt,.md,image/*,application/pdf,text/csv,text/plain," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const PASTE_EXAMPLE = `Meal 1: Breakfast
3 eggs
2 slices toast

Meal 2: Lunch
150 g chicken breast
200 g cooked rice`;

type Picked =
  | { mode: "local"; doc: SourceDoc; file: File; detail: string }
  | { mode: "upload"; kind: "pdf" | "image"; files: File[]; bytes: number; name: string; detail: string };

export type ImportStarted = { id: string; status: "ready" | "pending"; result?: MealImportResult };

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const safeName = (n: string) => n.replace(/[^\w.\- ]+/g, "_").slice(-80) || "file";

/** The original's name and type as it's kept, so the documents library takes it (its extension matches what's in it). */
function keptAs(kind: SourceDoc["kind"], name: string): { name: string; type: string } {
  const base = safeName(name).replace(/\.[a-z0-9]{1,5}$/i, "") || "meal-plan";
  if (kind === "xlsx") return { name: `${base}.xlsx`, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  if (kind === "docx") return { name: `${base}.docx`, type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  if (kind === "csv" && /\.csv$/i.test(name)) return { name: `${base}.csv`, type: "text/csv" };
  return { name: `${base}.txt`, type: "text/plain" };
}

/** A photo as a JPEG no bigger than a page needs (an iPhone photo is 3–6 MB; this is a few hundred KB). */
async function photoForUpload(file: File, max = 2000): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) return file;
    throw new Error("That photo couldn't be opened. Try a screenshot of it instead.");
  }
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.86));
  if (!blob) throw new Error("That photo couldn't be prepared. Try again.");
  return blob;
}

export function PlanSourcePicker({
  audience,
  allowPaste = true,
  onStarted,
  goLabel = "Import plan",
  className,
}: {
  audience: "member" | "staff";
  allowPaste?: boolean;
  onStarted: (r: ImportStarted) => void;
  goLabel?: string;
  className?: string;
}) {
  const { user } = useAuth();
  const start = useServerFn(startMealPlanImport);
  const member = audience === "member";
  const credits = useAiCredits(member);
  const setCredits = useSetCreditState();

  const [tab, setTab] = useState<"file" | "paste">("file");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [paste, setPaste] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [needAgree, setNeedAgree] = useState(false);
  const [busy, setBusy] = useState<null | "reading" | "uploading" | "sending">(null);
  // Which file is going up, of how many ("Uploading 2 of 5…"): real counts, never a made-up percent.
  const [uploadStep, setUploadStep] = useState<{ at: number; of: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const usesAi = picked?.mode === "upload";
  const hasSource = tab === "file" ? !!picked : paste.trim().length > 0;
  const rightsText = rightsTextFor(audience);

  const choose = async (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setError(null);
    setOutOfCredits(false);
    const { fileKind, readLocalFile, UnreadableFile } = await import("@/lib/program-import/extract");
    const kinds = files.map((f) => fileKind(f.name, f.type));
    if (files.length > 1) {
      if (!kinds.every((k) => k === "image")) return setError("Pick one file, or several photos of the same plan.");
      if (files.length > MAX_PHOTOS) return setError(`Up to ${MAX_PHOTOS} photos at a time.`);
    }
    const f = files[0];
    const kind = kinds[0];
    if (kind === "xls")
      return setError("That's an older Excel file (.xls). Open it in Excel, Numbers or Google Sheets, save it as .xlsx, then import that.");
    if (kind === "unsupported")
      return setError("That kind of file can't be read. Use a spreadsheet (.xlsx or .csv), a Word document (.docx), a text file, a PDF, photos, or paste the text.");
    if (kind === "pdf" || kind === "image") {
      if (kind === "pdf" && f.size > MAX_PDF_BYTES)
        return setError(`That PDF is ${mb(f.size)}. Up to ${mb(MAX_PDF_BYTES)}: send just the pages with the plan, or photos of them.`);
      setPicked({
        mode: "upload",
        kind,
        files,
        bytes: files.reduce((n, x) => n + x.size, 0),
        name: kind === "image" && files.length > 1 ? `${files.length} photos` : f.name,
        detail: kind === "pdf" ? `PDF · ${mb(f.size)}` : files.length > 1 ? `${files.length} photos` : "Photo",
      });
      return;
    }
    if (f.size > MAX_LOCAL_BYTES) return setError(`That file is ${mb(f.size)}. A meal plan file is far smaller.`);
    setBusy("reading");
    try {
      const doc = readLocalFile(f.name, kind, new Uint8Array(await f.arrayBuffer()));
      if (!doc.text.trim()) throw new UnreadableFile("There's nothing to read in that file.");
      setPicked({
        mode: "local",
        doc,
        file: f,
        detail:
          kind === "xlsx" || kind === "csv"
            ? `Spreadsheet · ${mb(f.size)}`
            : kind === "docx"
              ? `Word document · ${mb(f.size)}`
              : `Text · ${mb(f.size)}`,
      });
    } catch (e: any) {
      setError(e instanceof UnreadableFile ? e.message : "That file couldn't be opened. If it's protected with a password, save an unprotected copy.");
    } finally {
      setBusy(null);
    }
  };

  const go = async () => {
    setError(null);
    if (!hasSource) return setError(tab === "file" ? "Choose a file first." : "Paste your plan first.");
    if (!agreed) return setNeedAgree(true);
    if (!user?.id) return;
    let uploaded: string[] = [];
    const folder = crypto.randomUUID();
    try {
      let r: StartImportResult;
      if (tab === "paste") {
        setBusy("sending");
        r = await start({ data: { audience, kind: "text", fileName: null, text: paste.slice(0, MAX_SEND_TEXT), rightsConfirmed: true } });
      } else if (picked?.mode === "local") {
        // the original is kept privately so a saved import can file it in their documents (best effort)
        setBusy("uploading");
        const as = keptAs(picked.doc.kind, picked.file.name);
        const path = `${user.id}/${folder}/${as.name}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, picked.file, { contentType: as.type, upsert: false });
        if (!upErr) uploaded = [path];
        setBusy("sending");
        if (picked.doc.text.length > MAX_SEND_TEXT) toast("Your file is long: the first part of it is read.");
        r = await start({
          data: {
            audience,
            kind: picked.doc.kind,
            fileName: picked.file.name.slice(0, 200),
            text: picked.doc.text.slice(0, MAX_SEND_TEXT),
            paths: uploaded,
            bytes: picked.file.size,
            rightsConfirmed: true,
          },
        });
      } else if (picked?.mode === "upload") {
        setBusy("uploading");
        let total = 0;
        for (const [i, f] of picked.files.entries()) {
          setUploadStep({ at: i + 1, of: picked.files.length });
          const body = picked.kind === "image" ? await photoForUpload(f) : f;
          const type = picked.kind === "image" ? "image/jpeg" : "application/pdf";
          const name = picked.kind === "image" ? `${i + 1}.jpg` : safeName(f.name.toLowerCase().endsWith(".pdf") ? f.name : `${f.name}.pdf`);
          const path = `${user.id}/${folder}/${name}`;
          const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, body, { contentType: type, upsert: false });
          if (upErr) throw new Error("Your file didn't upload. Check your connection and try again.");
          uploaded.push(path);
          total += body.size;
        }
        setUploadStep(null);
        setBusy("sending");
        r = await start({ data: { audience, kind: picked.kind, fileName: picked.name.slice(0, 200), paths: uploaded, bytes: total, rightsConfirmed: true } });
      } else return;

      if (r.ok) {
        uploaded = [];
        if (r.status === "pending" && member) void credits.refetch();
        onStarted({ id: r.id, status: r.status, result: r.result });
        return;
      }
      if (r.reason === "out_of_credits") {
        setCredits(r.credits);
        setOutOfCredits(true);
        return;
      }
      setError(r.message);
    } catch (e: any) {
      setError(String(e?.message ?? "Something went wrong. Try again."));
    } finally {
      // a file that went up for an import that didn't start isn't kept
      if (uploaded.length) void supabase.storage.from(BUCKET).remove(uploaded);
      setUploadStep(null);
      setBusy(null);
    }
  };

  return (
    <div className={className} data-meal-import-start>
      {allowPaste && (
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="tablist" aria-label="How to bring it in">
          {(["file", "paste"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => {
                setTab(t);
                setError(null);
              }}
              className={cn("h-10 rounded-lg text-[14px] font-medium transition", tab === t ? "bg-background text-foreground" : "text-muted-foreground")}
            >
              {t === "file" ? "Upload a file" : "Paste text"}
            </button>
          ))}
        </div>
      )}

      {tab === "file" ? (
        <div className={allowPaste ? "mt-3" : ""}>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              void choose(e.target.files);
              e.target.value = "";
            }}
          />
          {picked ? (
            <div className="flex items-center gap-3 rounded-2xl border border-border p-3" data-meal-import-picked>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted">
                {picked.mode === "upload" && picked.kind === "image" ? (
                  <ImageIcon className="h-5 w-5" aria-hidden />
                ) : picked.mode === "local" && (picked.doc.kind === "xlsx" || picked.doc.kind === "csv") ? (
                  <FileSpreadsheet className="h-5 w-5" aria-hidden />
                ) : (
                  <FileText className="h-5 w-5" aria-hidden />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{picked.mode === "local" ? picked.file.name : picked.name}</span>
                <span className="block text-[13px] text-muted-foreground">{picked.detail}</span>
              </span>
              <button type="button" onClick={() => setPicked(null)} aria-label="Remove file" className="grid h-10 w-10 place-items-center rounded-full hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void choose(e.dataTransfer.files);
              }}
              disabled={busy === "reading"}
              className={cn(
                "flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition",
                dragging ? "border-foreground bg-muted/60" : "border-border hover:bg-muted/30",
              )}
              data-meal-import-drop
            >
              {busy === "reading" ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden /> : <Upload className="h-6 w-6 text-muted-foreground" aria-hidden />}
              <span className="text-[16px] font-semibold">{busy === "reading" ? "Reading your file…" : "Choose a file"}</span>
              <span className="text-[13px] text-muted-foreground">PDF, photos, Excel, CSV, Word or text</span>
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={PASTE_EXAMPLE}
            aria-label="Your meal plan as text"
            rows={10}
            className="block min-h-56 w-full resize-y rounded-2xl border border-border bg-background p-4 font-mono text-[16px] leading-relaxed outline-none placeholder:text-muted-foreground/70 focus:border-foreground/40 md:text-[14px]"
            data-meal-import-paste
          />
          <p className="mt-1.5 text-[13px] text-muted-foreground">Copy it from an email, a note or a document. Day and meal headings help.</p>
        </div>
      )}

      {member && (
        <div className="mt-4 flex items-start justify-between gap-3">
          <p className="text-[13px] leading-relaxed text-muted-foreground" data-meal-import-cost>
            {usesAi
              ? `Reading a PDF or photos takes ${COST} credits, given back if it can't be read.`
              : `Most plans are read in a second, free. If yours needs a full read, that's ${COST} credits, given back if it can't be read.`}
          </p>
          <AiCreditsChip state={credits.data} onClick={() => setCreditsOpen(true)} className="shrink-0" />
        </div>
      )}

      <div className={cn("mt-4 rounded-2xl border p-4", needAgree && !agreed ? "border-destructive" : "border-border")} data-meal-import-rights>
        <label className="flex cursor-pointer items-start gap-3">
          <Checkbox
            checked={agreed}
            onCheckedChange={(v) => {
              setAgreed(v === true);
              if (v === true) setNeedAgree(false);
            }}
            className="mt-0.5 h-5 w-5"
          />
          <span className="text-[15px] leading-snug">{rightsText}</span>
        </label>
        {member && <p className="mt-2 pl-8 text-[13px] leading-relaxed text-muted-foreground">{MEAL_IMPORT_RIGHTS_EXPLAINER}</p>}
        {needAgree && !agreed && (
          <p className="mt-2 pl-8 text-[13px] font-medium text-destructive" role="alert">
            Tick the box to confirm you may use this plan.
          </p>
        )}
      </div>

      <details className="mt-3 text-[13px] text-muted-foreground">
        <summary className="cursor-pointer py-1 font-medium">How your file is handled</summary>
        <p className="mt-1 leading-relaxed">{MEAL_IMPORT_PRIVACY_TEXT}</p>
      </details>

      {error && (
        <p className="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-[14px] text-destructive" role="alert" data-meal-import-error>
          {error}
        </p>
      )}

      {outOfCredits && (
        <div className="mt-4 rounded-2xl border border-border p-4" role="alert" data-meal-import-out-of-credits>
          <p className="text-[15px] font-semibold">Not enough credits this month</p>
          <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
            {`A full read takes ${COST} credits. `}
            {picked?.mode === "upload"
              ? "PDFs and photos need one. Get more credits, or copy the plan's text and paste it in instead."
              : "Get more credits, or tidy the plan into a meal per heading with one food per line and try again."}
          </p>
          <Button variant="outline" className="mt-3" onClick={() => setCreditsOpen(true)}>
            Get credits
          </Button>
        </div>
      )}

      {/* the coach's plan editor keeps Save its only red button */}
      <Button
        variant={member ? "default" : "outline"}
        className={cn("mt-5 w-full", member ? "h-12 text-[16px]" : "h-11")}
        onClick={() => void go()}
        disabled={!!busy}
        data-meal-import-go
      >
        {busy === "uploading" ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {uploadStep && uploadStep.of > 1 ? `Uploading ${uploadStep.at} of ${uploadStep.of}…` : "Uploading…"}
          </>
        ) : busy === "sending" ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Reading your plan…
          </>
        ) : (
          goLabel
        )}
      </Button>

      {member && <AiCreditsSheet open={creditsOpen} onOpenChange={setCreditsOpen} out={outOfCredits} feature="nutrition_import" />}
    </div>
  );
}
