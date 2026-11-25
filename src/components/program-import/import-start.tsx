import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, FileText, Image as ImageIcon, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AiCreditsChip, AiCreditsSheet, useAiCredits, useSetCreditState } from "@/components/ai-credits/ai-credits";
import { FEATURE_COSTS } from "@/lib/ai-credits/packs";
import { startProgramImport, type StartResult } from "@/lib/program-import/import.functions";
import { IMPORT_PRIVACY_TEXT, IMPORT_RIGHTS_EXPLAINER, IMPORT_RIGHTS_TEXT } from "@/lib/program-import/rights";
import { importKeys } from "@/lib/program-import/queries";
import { OpenImports } from "./open-imports";
import { ImportSteps } from "./import-steps";
import type { SourceDoc } from "@/lib/program-import/types";
import { useAiConsentAware } from "@/components/ai-consent/ai-consent";

const COST = FEATURE_COSTS.program_import;
const MAX_LOCAL_BYTES = 15 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_PHOTOS = 10;
const MAX_SEND_TEXT = 150_000;
const ACCEPT =
  ".xlsx,.xlsm,.xls,.csv,.tsv,.docx,.pdf,.txt,.md,image/*,application/pdf,text/csv,text/plain," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type Picked =
  | { mode: "local"; doc: SourceDoc; bytes: number; detail: string }
  | { mode: "upload"; kind: "pdf" | "image"; files: File[]; bytes: number; name: string; detail: string };

const PASTE_EXAMPLE = `Week 1
Day 1: Lower
Back Squat 4x5 @ RPE 7
Romanian Deadlift 3x8, 2 min rest
Leg Press 3x10-12

Day 2: Upper
Bench Press 5x5 @ 75%
A1. Chin-up 3x8
A2. Dumbbell Row 3x10`;

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

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

const safeName = (n: string) => n.replace(/[^\w.\- ]+/g, "_").slice(-80) || "file";

/**
 * Bring a program you already have: a spreadsheet, a Word document, a PDF,
 * photos of it, or the text pasted in. Spreadsheets, documents and text are
 * read on the phone (nothing leaves it until it's sent to be checked); a PDF
 * or photos are uploaded privately for the AI to read. Before anything goes,
 * the person confirms they may use the program, and sees what it costs.
 */
export function ImportStart({ startWithPaste = false }: { startWithPaste?: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const start = useAiConsentAware(useServerFn(startProgramImport));
  const credits = useAiCredits();
  const setCredits = useSetCreditState();

  const [tab, setTab] = useState<"file" | "paste">(startWithPaste ? "paste" : "file");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [paste, setPaste] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState<null | "reading" | "uploading" | "sending">(null);
  // Which file is going up, of how many ("Uploading 2 of 5…"): real counts, never a made-up percent.
  const [uploadStep, setUploadStep] = useState<{ at: number; of: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needAgree, setNeedAgree] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [outOfCredits, setOutOfCredits] = useState<null | { partial: boolean }>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const usesAi = picked?.mode === "upload";
  const hasSource = tab === "file" ? !!picked : paste.trim().length > 0;

  const choose = async (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setError(null);
    setOutOfCredits(null);
    const { fileKind, readLocalFile, UnreadableFile } = await import("@/lib/program-import/extract");
    const kinds = files.map((f) => fileKind(f.name, f.type));
    if (files.length > 1) {
      if (!kinds.every((k) => k === "image")) {
        setError("Pick one file, or several photos of the same program.");
        return;
      }
      if (files.length > MAX_PHOTOS) {
        setError(`Up to ${MAX_PHOTOS} photos at a time.`);
        return;
      }
    }
    const f = files[0];
    const kind = kinds[0];
    if (kind === "xls") {
      setError("That's an older Excel file (.xls). Open it in Excel, Numbers or Google Sheets, save it as .xlsx, then import that.");
      return;
    }
    if (kind === "unsupported") {
      setError("That kind of file can't be read. Use a spreadsheet (.xlsx or .csv), a Word document (.docx), a PDF, photos, or paste the text.");
      return;
    }
    if (kind === "pdf" || kind === "image") {
      const bytes = files.reduce((n, x) => n + x.size, 0);
      if (kind === "pdf" && f.size > MAX_PDF_BYTES) {
        setError(`That PDF is ${mb(f.size)}. Up to ${mb(MAX_PDF_BYTES)}: send just the pages with the program, or photos of them.`);
        return;
      }
      setPicked({
        mode: "upload",
        kind,
        files,
        bytes,
        name: kind === "image" && files.length > 1 ? `${files.length} photos` : f.name,
        detail: kind === "pdf" ? `PDF · ${mb(f.size)}` : files.length > 1 ? `${files.length} photos` : "Photo",
      });
      return;
    }
    if (f.size > MAX_LOCAL_BYTES) {
      setError(`That file is ${mb(f.size)}. A program file is far smaller: export just the program's sheets.`);
      return;
    }
    setBusy("reading");
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const doc = readLocalFile(f.name, kind, bytes);
      if (!doc.text.trim()) throw new UnreadableFile("There's nothing to read in that file.");
      const sheets = doc.sheets?.length ?? 0;
      const rows = doc.sheets?.reduce((n, s) => n + s.rows.length, 0) ?? 0;
      setPicked({
        mode: "local",
        doc,
        bytes: f.size,
        detail:
          kind === "xlsx" || kind === "csv"
            ? `${sheets} ${sheets === 1 ? "sheet" : "sheets"} · ${rows} rows`
            : kind === "docx"
              ? `Word document${sheets ? ` · ${sheets} ${sheets === 1 ? "table" : "tables"}` : ""}`
              : `Text · ${mb(f.size)}`,
      });
    } catch (e: any) {
      setError(e instanceof UnreadableFile ? e.message : "That file couldn't be opened. If it's protected with a password, save an unprotected copy.");
    } finally {
      setBusy(null);
    }
  };

  const go = async (opts: { acceptPartial?: boolean } = {}) => {
    setError(null);
    if (!hasSource) {
      setError(tab === "file" ? "Choose a file first." : "Paste your program first.");
      return;
    }
    if (!agreed) {
      setNeedAgree(true);
      return;
    }
    if (!user?.id) return;
    let uploaded: string[] = [];
    try {
      let r: StartResult;
      if (tab === "paste") {
        setBusy("sending");
        r = await start({ data: { kind: "text", fileName: null, text: paste.slice(0, MAX_SEND_TEXT), rightsConfirmed: true, ...opts } });
      } else if (picked?.mode === "local") {
        setBusy("sending");
        const sheets = picked.doc.sheets?.slice(0, 40).map((s) => ({
          name: s.name.slice(0, 400),
          rows: s.rows.slice(0, 2000).map((row) => row.slice(0, 60).map((c) => c.slice(0, 2000))),
        }));
        if (picked.doc.text.length > MAX_SEND_TEXT) toast("Your file is long: the first part of it is read.");
        r = await start({
          data: {
            kind: picked.doc.kind,
            fileName: picked.doc.name.slice(0, 200),
            text: picked.doc.text.slice(0, MAX_SEND_TEXT),
            sheets: sheets ?? null,
            bytes: picked.bytes,
            rightsConfirmed: true,
            ...opts,
          },
        });
      } else if (picked?.mode === "upload") {
        setBusy("uploading");
        const folder = crypto.randomUUID();
        let total = 0;
        for (const [i, f] of picked.files.entries()) {
          setUploadStep({ at: i + 1, of: picked.files.length });
          const body = picked.kind === "image" ? await photoForUpload(f) : f;
          const type = picked.kind === "image" ? "image/jpeg" : "application/pdf";
          const name = picked.kind === "image" ? `${i + 1}.jpg` : safeName(f.name.toLowerCase().endsWith(".pdf") ? f.name : `${f.name}.pdf`);
          const path = `${user.id}/${folder}/${name}`;
          const { error: upErr } = await supabase.storage.from("program-imports").upload(path, body, { contentType: type, upsert: false });
          if (upErr) throw new Error("Your file didn't upload. Check your connection and try again.");
          uploaded.push(path);
          total += body.size;
        }
        setUploadStep(null);
        setBusy("sending");
        r = await start({
          data: { kind: picked.kind, fileName: picked.name.slice(0, 200), paths: uploaded, bytes: total, rightsConfirmed: true },
        });
      } else return;

      if (r.ok) {
        uploaded = [];
        void qc.invalidateQueries({ queryKey: importKeys.recent });
        if (r.status === "pending") void credits.refetch();
        navigate({ to: "/portal/programs/import", search: { id: r.id } });
        return;
      }
      if (r.reason === "out_of_credits") {
        setCredits(r.credits);
        setOutOfCredits({ partial: r.partial });
        return;
      }
      setError(r.message);
    } catch (e: any) {
      setError(String(e?.message ?? "Something went wrong. Try again."));
    } finally {
      // a file that went up for an import that didn't start isn't kept
      if (uploaded.length) void supabase.storage.from("program-imports").remove(uploaded);
      setUploadStep(null);
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-32 pt-2 md:px-8" data-import-start>
      <ImportSteps at={1} className="mb-4" />
      <p className="text-[15px] leading-relaxed text-muted-foreground">
        Bring a program you already follow. Its weeks, days, exercises and numbers come in as written, matched to the
        exercise library, ready for you to check and save.
      </p>

      <OpenImports className="mt-5" importsOnly />

      {/* File or paste */}
      <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="tablist" aria-label="How to bring it in">
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
            className={cn(
              "h-10 rounded-lg text-[14px] font-medium transition",
              tab === t ? "bg-background text-foreground" : "text-muted-foreground",
            )}
          >
            {t === "file" ? "Upload a file" : "Paste text"}
          </button>
        ))}
      </div>

      {tab === "file" ? (
        <div className="mt-3">
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
            <div className="flex items-center gap-3 rounded-2xl border border-border p-4" data-import-picked>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-muted">
                {picked.mode === "upload" && picked.kind === "image" ? (
                  <ImageIcon className="h-5 w-5" aria-hidden />
                ) : picked.mode === "local" && (picked.doc.kind === "xlsx" || picked.doc.kind === "csv") ? (
                  <FileSpreadsheet className="h-5 w-5" aria-hidden />
                ) : (
                  <FileText className="h-5 w-5" aria-hidden />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{picked.mode === "local" ? picked.doc.name : picked.name}</span>
                <span className="block text-[13px] text-muted-foreground">{picked.detail}</span>
              </span>
              <button
                type="button"
                onClick={() => setPicked(null)}
                aria-label="Remove file"
                className="grid h-10 w-10 place-items-center rounded-full hover:bg-muted"
              >
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
                "flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition",
                dragging ? "border-foreground bg-muted/60" : "border-border hover:bg-muted/30",
              )}
              data-import-drop
            >
              {busy === "reading" ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
              ) : (
                <Upload className="h-6 w-6 text-muted-foreground" aria-hidden />
              )}
              <span className="text-[16px] font-semibold">
                {busy === "reading" ? "Reading your file…" : (
                  <>
                    <span className="md:hidden">Choose a file</span>
                    <span className="hidden md:inline">Drop a file here, or choose one</span>
                  </>
                )}
              </span>
              <span className="text-[13px] text-muted-foreground">Excel, CSV, Word, PDF or photos</span>
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={PASTE_EXAMPLE}
            aria-label="Your program as text"
            rows={12}
            className="block min-h-64 w-full resize-y rounded-2xl border border-border bg-background p-4 font-mono text-[16px] leading-relaxed outline-none placeholder:text-muted-foreground/70 focus:border-foreground/40 md:text-[14px]"
            data-import-paste
          />
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            Copy it straight from Google Sheets, Notes, an email or a website. Week and day headings help.
          </p>
        </div>
      )}

      {/* What it costs */}
      <div className="mt-4 flex items-start justify-between gap-3">
        <p className="text-[13px] leading-relaxed text-muted-foreground" data-import-cost>
          {usesAi
            ? `Reading a PDF or photos takes ${COST} credits, given back if it can't be read.`
            : `Most programs are read in a second, free. If yours needs a full read, that's ${COST} credits, given back if it can't be read.`}
        </p>
        <AiCreditsChip state={credits.data} onClick={() => setCreditsOpen(true)} className="shrink-0" />
      </div>

      {/* Rights */}
      <div
        className={cn("mt-4 rounded-2xl border p-4", needAgree && !agreed ? "border-destructive" : "border-border")}
        data-import-rights
      >
        <label className="flex cursor-pointer items-start gap-3">
          <Checkbox
            checked={agreed}
            onCheckedChange={(v) => {
              setAgreed(v === true);
              if (v === true) setNeedAgree(false);
            }}
            className="mt-0.5 h-5 w-5"
            aria-describedby="import-rights-explainer"
          />
          <span className="text-[15px] leading-snug">{IMPORT_RIGHTS_TEXT}</span>
        </label>
        <p id="import-rights-explainer" className="mt-2 pl-8 text-[13px] leading-relaxed text-muted-foreground">
          {IMPORT_RIGHTS_EXPLAINER}
        </p>
        {needAgree && !agreed && (
          <p className="mt-2 pl-8 text-[13px] font-medium text-destructive" role="alert">
            Tick the box to confirm you may use this program.
          </p>
        )}
      </div>

      <details className="mt-3 text-[13px] text-muted-foreground">
        <summary className="cursor-pointer py-1 font-medium">How your file is handled</summary>
        <p className="mt-1 leading-relaxed">{IMPORT_PRIVACY_TEXT}</p>
      </details>

      {error && (
        <p className="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-[14px] text-destructive" role="alert" data-import-error>
          {error}
        </p>
      )}

      {outOfCredits && (
        <div className="mt-4 rounded-2xl border border-border p-4" role="alert" data-import-out-of-credits>
          <p className="text-[15px] font-semibold">Not enough credits this month</p>
          <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
            {`A full read takes ${COST} credits. `}
            {outOfCredits.partial
              ? "Part of your program could be read for free. Review what was read and fill in the rest yourself, or get more credits to have all of it read."
              : picked?.mode === "upload"
                ? "PDFs and photos need a full read. Get more credits, or copy the program's text and paste it in instead."
                : "Your program needs a full read. Get more credits, or tidy it into one exercise per line and try again."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {outOfCredits.partial && (
              <Button onClick={() => void go({ acceptPartial: true })} disabled={!!busy}>
                Review what was read
              </Button>
            )}
            <Button variant="outline" onClick={() => setCreditsOpen(true)}>
              Get credits
            </Button>
          </div>
        </div>
      )}

      <Button
        className="mt-5 h-12 w-full text-[16px]"
        onClick={() => void go()}
        disabled={!!busy}
        data-import-go
      >
        {busy === "uploading" ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {uploadStep && uploadStep.of > 1 ? `Uploading ${uploadStep.at} of ${uploadStep.of}…` : "Uploading…"}
          </>
        ) : busy === "sending" ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Reading your program…
          </>
        ) : usesAi ? (
          `Import program · ${COST} credits`
        ) : (
          "Import program"
        )}
      </Button>
      <p className="mt-2 text-center text-[13px] text-muted-foreground">
        You'll check everything before it's saved. Imported programs are private to you.
      </p>

      <AiCreditsSheet open={creditsOpen} onOpenChange={setCreditsOpen} out={!!outOfCredits} feature="program_import" />
    </div>
  );
}
