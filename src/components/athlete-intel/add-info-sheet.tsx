/**
 * Add athlete information (Nov 26 2026): drop, pick, paste or type it, and
 * Upload & analyze. Everything else is optional and prefilled: who it's from
 * (remembered per athlete; their coach's name when it's known; Unknown
 * never misattributes, and Cleo reads who wrote it from the file when it
 * says), what it's for (Cleo detects it), a line of context. Files go up
 * with real progress and are read in the background, so the sheet can close
 * as soon as they're up. A link lets their coach or the athlete add it
 * themselves.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, FileUp, Link2, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { addNoteFn, createLinkFn, finishUploadFn, startUploadFn } from "@/lib/athlete-intel/intel.functions";
import { ACCEPT, RIGHTS_TEXT } from "@/lib/athlete-intel/uploads";
import { PROVIDER_LABEL, PURPOSE_LABEL, PURPOSES, type Provider, type Purpose } from "@/lib/athlete-intel/types";
import { sendFiles, type Picked, type Progress } from "./upload";

const PROVIDER_CHOICES: Provider[] = ["primary_coach", "athlete", "handler", "other_coach", "other", "unknown"];
const remembered = (clientId: string): { provider: Provider; name: string } | null => {
  try {
    const v = JSON.parse(localStorage.getItem(`jf-intel-provider:${clientId}`) ?? "null");
    return v && PROVIDER_CHOICES.includes(v.provider) ? v : null;
  } catch {
    return null;
  }
};
const remember = (clientId: string, v: { provider: Provider; name: string }) => {
  try {
    localStorage.setItem(`jf-intel-provider:${clientId}`, JSON.stringify(v));
  } catch {
    /* a convenience only */
  }
};

let keySeq = 0;

export function AddInfoSheet({
  open,
  onOpenChange,
  clientId,
  competitionId,
  athleteFirst,
  coachName,
  coachContactOk,
  replaces,
  initialFiles,
  onSent,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  competitionId: string | null;
  athleteFirst: string;
  /** their own coach's name, when it's known (handling) */
  coachName: string | null;
  /** the athlete said their coach may be contacted */
  coachContactOk: boolean;
  /** a file being replaced with a newer version */
  replaces?: { id: string; name: string } | null;
  initialFiles?: File[] | null;
  onSent: () => void;
}) {
  const start = useServerFn(startUploadFn);
  const finish = useServerFn(finishUploadFn);
  const addNote = useServerFn(addNoteFn);
  const makeLink = useServerFn(createLinkFn);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [text, setText] = useState("");
  const [provider, setProvider] = useState<Provider>("unknown");
  const [name, setName] = useState("");
  const [purposes, setPurposes] = useState<Purpose[]>([]);
  const [context, setContext] = useState("");
  const [rights, setRights] = useState(false);
  const [progress, setProgress] = useState<Progress>({});
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [more, setMore] = useState(false);
  const [link, setLink] = useState<{ url: string; role: string } | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const r = remembered(clientId);
    setProvider(r?.provider ?? "unknown");
    setName(r?.name || (r?.provider === "primary_coach" ? coachName ?? "" : ""));
    setPicked((initialFiles ?? []).map((file) => ({ file, key: `f${++keySeq}` })));
    setText("");
    setPurposes([]);
    setContext("");
    setRights(false);
    setProgress({});
    setLink(null);
    setMore(false);
  }, [open, clientId, coachName, initialFiles]);

  const addFiles = useCallback((files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files).slice(0, 12);
    setPicked((p) => [...p, ...list.map((file) => ({ file, key: `f${++keySeq}` }))].slice(0, 12));
  }, []);

  // paste: files (screenshots) become uploads; text goes in the box as usual
  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const needsName = provider === "primary_coach" || provider === "other_coach" || provider === "other";
  const canSend = (picked.length > 0 && rights) || (!picked.length && text.trim().length >= 2);
  const pendingSummary = useMemo(() => {
    const vals = Object.values(progress);
    if (!vals.length) return null;
    const done = vals.filter((v) => v.state === "done" || v.state === "duplicate").length;
    return `${done} of ${vals.length} up`;
  }, [progress]);

  const send = async () => {
    setBusy(true);
    const base = {
      clientId,
      competitionId,
      provider,
      providerName: needsName ? name.trim() || null : null,
      purposes,
      context: context.trim() || null,
    };
    try {
      remember(clientId, { provider, name: name.trim() });
      let sent = 0;
      if (picked.length) {
        const r = await sendFiles(
          picked,
          (files) => start({ data: { ...base, files, rightsConfirmed: true, replacesId: replaces?.id ?? null } }) as any,
          (sourceId, extracted, failed) => finish({ data: { sourceId, extracted, failed } }),
          setProgress,
        );
        sent += r.sent;
        if (r.duplicates) toast.message(`${r.duplicates} already added: not read twice`);
        if (r.problems.length) toast.error(r.problems[0]);
      }
      if (text.trim().length >= 2) {
        await addNote({ data: { ...base, text: text.trim() } });
        sent++;
      }
      if (sent) {
        toast.success(sent === 1 ? "Added: Cleo is reading it" : `${sent} added: Cleo is reading them`);
        onSent();
        onOpenChange(false);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't add it");
    } finally {
      setBusy(false);
    }
  };

  const shareLink = async (role: "primary_coach" | "athlete") => {
    setLinkBusy(true);
    try {
      const r = await makeLink({ data: { clientId, competitionId, role, name: role === "primary_coach" ? coachName : null } });
      setLink({ url: r.url, role });
      try {
        await navigator.clipboard.writeText(r.url);
        toast.success("Link copied");
      } catch {
        /* shown below to copy by hand */
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't make a link");
    } finally {
      setLinkBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg" data-intel-add onPaste={onPaste}>
        <SheetHeader className="text-left">
          <SheetTitle>{replaces ? `Replace ${replaces.name}` : competitionId ? `Add competition files for ${athleteFirst}` : `Add information about ${athleteFirst}`}</SheetTitle>
          <SheetDescription>
            Drop schedules, nominations, rules, training logs, programs, coach notes, warm-ups or attempt plans. Cleo organizes them, extracts relevant details and proposes changes to this meet.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-3 space-y-3">
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
              addFiles(e.dataTransfer.files);
            }}
            className={cn(
              "flex w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-3 py-4 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
              dragging ? "border-primary bg-primary/15" : "border-primary/55 bg-primary/5 hover:bg-primary/10",
            )}
            disabled={busy}
            data-intel-drop
          >
            <span className="mb-1 rounded-lg bg-primary/10 p-2 text-foreground"><FileUp className="h-5 w-5" /></span>
            <span className="text-[14px] font-semibold">Drop files or browse</span>
            <span className="text-[12px] text-muted-foreground">PDF, spreadsheets, Word, photos, video · paste supported</span>
          </button>
          <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />

          {picked.length ? (
            <ul className="space-y-1" data-intel-picked>
              {picked.map((p) => {
                const pr = progress[p.key];
                return (
                  <li key={p.key} className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate">{p.file.name}</span>
                    {pr ? (
                      <span className={cn("shrink-0 tabular-nums", pr.state === "failed" ? "text-destructive" : "text-muted-foreground")}>
                        {pr.state === "uploading" ? `${pr.percent}%` : pr.state === "hashing" ? "…" : pr.state === "reading" ? "Up" : pr.state === "done" ? "Up" : pr.state === "duplicate" ? "Already added" : "Didn't go"}
                      </span>
                    ) : (
                      <button type="button" aria-label={`Remove ${p.file.name}`} className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground" onClick={() => setPicked((x) => x.filter((y) => y.key !== p.key))}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}

          {!replaces ? (
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`Or type / paste notes: "Openers 170 / 105 / 200", "Squat rack 9", "Nov 18: squat 182.5×2 @8.5"…`}
              className="min-h-[64px] bg-background text-[14px]"
              data-intel-text
            />
          ) : null}

          <div className="space-y-1.5 border-t border-border pt-3">
            <p className="text-[12.5px] font-medium">Provided by</p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Provided by">
              {PROVIDER_CHOICES.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={provider === p}
                  onClick={() => {
                    setProvider(p);
                    if (p === "primary_coach" && !name && coachName) setName(coachName);
                  }}
                  className={cn("h-8 rounded-full border px-3 text-[12.5px]", provider === p ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground")}
                >
                  {p === "primary_coach" && coachName ? coachName : PROVIDER_LABEL[p]}
                </button>
              ))}
            </div>
            {needsName ? (
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Their name (optional)" className="h-9 text-[14px]" />
            ) : null}
            {provider === "unknown" ? <p className="text-[11.5px] text-muted-foreground">Cleo reads who wrote it from the file when it says.</p> : null}
          </div>

          <button type="button" aria-expanded={more} className="text-[12.5px] font-medium underline-offset-2 hover:underline" onClick={() => setMore((m) => !m)}>
            {more ? "Hide optional details" : "Purpose & context (optional)"}
          </button>
          {more ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setPurposes([])}
                  className={cn("h-8 rounded-full border px-3 text-[12.5px]", !purposes.length ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground")}
                >
                  Detect automatically
                </button>
                {PURPOSES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={purposes.includes(p)}
                    onClick={() => setPurposes((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]))}
                    className={cn("h-8 rounded-full border px-3 text-[12.5px]", purposes.includes(p) ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground")}
                  >
                    {PURPOSE_LABEL[p]}
                  </button>
                ))}
              </div>
              <Input value={context} onChange={(e) => setContext(e.target.value)} maxLength={1000} placeholder="Anything Cleo should know (optional)" className="h-9 text-[14px]" />
            </div>
          ) : null}

          {picked.length ? (
            <label className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
              <Checkbox checked={rights} onCheckedChange={(v) => setRights(v === true)} className="mt-0.5" data-intel-rights />
              <span>{RIGHTS_TEXT}</span>
            </label>
          ) : null}

          <Button className="w-full" disabled={!canSend} loading={busy} loadingText={pendingSummary ?? "Uploading…"} onClick={send} data-intel-send>
            Upload &amp; analyze
          </Button>

          {!replaces ? (
            <div className="space-y-2 border-t border-border pt-3" data-intel-links>
              <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                <Link2 className="h-3.5 w-3.5" /> Or let them add it, no account needed
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" loading={linkBusy} disabled={!coachContactOk} onClick={() => shareLink("primary_coach")} title={coachContactOk ? undefined : `${athleteFirst} hasn't said their coach may be contacted`}>
                  Link for their coach
                </Button>
                <Button size="sm" variant="outline" loading={linkBusy} onClick={() => shareLink("athlete")}>
                  Link for {athleteFirst}
                </Button>
              </div>
              {link ? (
                <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{link.url}</span>
                  <Button size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(link.url).then(() => toast.success("Copied"))}>
                    <Copy /> Copy
                  </Button>
                </div>
              ) : null}
              {!coachContactOk ? <p className="text-[11.5px] text-muted-foreground">Their coach can be sent a link once {athleteFirst} says they may be contacted.</p> : null}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
