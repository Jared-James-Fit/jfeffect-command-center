import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, FileUp, Trophy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { answerShareFn, finishShareUploadFn, getShareFn, shareNoteFn, startShareUploadFn } from "@/lib/athlete-intel/intel.functions";
import { ACCEPT } from "@/lib/athlete-intel/uploads";
import { sendFiles, type Picked, type Progress } from "@/components/athlete-intel/upload";
import { shareMeta } from "@/lib/share-meta";
import { cn } from "@/lib/utils";

/**
 * Sharing information for an athlete's meet (jfeffect.com/share/<token>,
 * Nov 26 2026): their own coach (or the athlete) adds training logs, the
 * program, notes, attempts or warm-ups and answers what's been asked of them,
 * with no account. The token names nobody; the page shows the athlete's first
 * name and the meet, and nothing about anyone else. Files go up private and
 * are read for the handler; nothing here is ever shown back.
 */
export const Route = createFileRoute("/share/$token")({
  head: () => ({
    meta: [
      { title: "Share meet information · JF Effect" },
      { name: "robots", content: "noindex" },
      { name: "referrer", content: "no-referrer" },
      ...shareMeta({ title: "Share training with JF Effect", description: "Add training and meet details in a minute." }),
    ],
  }),
  component: SharePage,
});

type Share = Awaited<ReturnType<typeof getShareFn>>;
let seq = 0;

function SharePage() {
  const { token } = Route.useParams();
  const read = useServerFn(getShareFn);
  const start = useServerFn(startShareUploadFn);
  const finish = useServerFn(finishShareUploadFn);
  const note = useServerFn(shareNoteFn);
  const answer = useServerFn(answerShareFn);
  const [share, setShare] = useState<Share | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [rights, setRights] = useState(false);
  const [progress, setProgress] = useState<Progress>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(0);
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const input = useRef<HTMLInputElement>(null);

  const load = () => {
    setFailed(false);
    read({ data: { token } })
      .then((s) => {
        setShare(s);
        if (s.state === "ok" && s.name) setName(s.name);
      })
      .catch(() => setFailed(true));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token]);

  const add = (files: FileList | File[] | null) => files && setPicked((p) => [...p, ...Array.from(files).map((file) => ({ file, key: `s${++seq}` }))].slice(0, 8));

  const send = async () => {
    setBusy(true);
    try {
      let n = 0;
      if (picked.length) {
        const r = await sendFiles(
          picked,
          (files) => start({ data: { token, files, rightsConfirmed: true, name: name.trim() || null } }) as any,
          (sourceId, extracted, fail) => finish({ data: { token, sourceId, extracted, failed: fail } }),
          setProgress,
        );
        n += r.sent;
        if (r.problems.length) toast.error(r.problems[0]);
      }
      if (text.trim().length >= 2) {
        await note({ data: { token, text: text.trim(), name: name.trim() || null } });
        n++;
      }
      if (n) {
        setSent((x) => x + n);
        setPicked([]);
        setText("");
        setProgress({});
        toast.success("Sent. Thank you!");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send it");
    } finally {
      setBusy(false);
    }
  };

  if (failed)
    return (
      <Shell>
        <p className="text-center text-[15px]">This didn't load.</p>
        <Button variant="outline" className="mt-3 w-full" onClick={load}>
          Try again
        </Button>
      </Shell>
    );
  if (!share) return <Shell><p className="text-center text-sm text-muted-foreground">Opening…</p></Shell>;
  if (share.state !== "ok")
    return (
      <Shell>
        <h1 className="text-center text-xl font-semibold">{share.state === "expired" ? "This link ran out" : share.state === "revoked" ? "This link was cancelled" : "This link doesn't work"}</h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">Ask whoever sent it for a new one.</p>
      </Shell>
    );
  const s = share as Extract<Share, { state: "ok" }>;
  const forCoach = s.role !== "athlete";
  const canSend = (picked.length > 0 && rights) || (!picked.length && text.trim().length >= 2);
  return (
    <Shell>
      <div className="mb-5 text-center">
        <h1 className="text-xl font-semibold tracking-tight">{forCoach ? `Share ${s.first}'s training for the meet` : "Share your training for the meet"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {s.meet ? `${s.meet.name}, ${new Date(`${s.meet.date}T12:00:00Z`).toLocaleDateString("en-CA", { month: "long", day: "numeric", timeZone: "UTC" })}. ` : ""}
          Logs, the program, recent meets, warm-ups, attempts, cues: whatever you have. It's kept private and used only to prepare {forCoach ? `${s.first}` : "you"} for the meet.
        </p>
      </div>

      {s.questions.filter((q) => !answered.has(q.id)).length ? (
        <div className="mb-5 space-y-3">
          {s.questions
            .filter((q) => !answered.has(q.id))
            .map((q) => (
              <ShareQuestion
                key={q.id}
                q={q}
                onAnswer={async (v) => {
                  await answer({ data: { token, questionId: q.id, ...v } });
                  setAnswered((x) => new Set(x).add(q.id));
                  toast.success("Thanks: saved");
                }}
              />
            ))}
        </div>
      ) : null}

      <div className="space-y-3">
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            add(e.dataTransfer.files);
          }}
          className="flex w-full flex-col items-center gap-1 rounded-2xl border border-dashed border-border p-5 text-center hover:bg-muted/50"
        >
          <FileUp className="h-5 w-5 text-muted-foreground" />
          <span className="text-[14px] font-medium">Add files</span>
          <span className="text-[12px] text-muted-foreground">Excel, CSV, PDF, Word, photos, screenshots, video</span>
        </button>
        <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
        {picked.length ? (
          <ul className="space-y-1">
            {picked.map((p) => (
              <li key={p.key} className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{p.file.name}</span>
                {progress[p.key] ? (
                  <span className="text-muted-foreground">{progress[p.key].state === "uploading" ? `${progress[p.key].percent}%` : progress[p.key].state === "done" ? "Sent" : progress[p.key].state === "failed" ? "Didn't go" : "…"}</span>
                ) : (
                  <button type="button" aria-label="Remove" onClick={() => setPicked((x) => x.filter((y) => y.key !== p.key))}>
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={forCoach ? `Or type notes: openers, warm-ups, cues, how training's gone…` : "Or type notes: recent lifts, openers, rack heights…"} className="min-h-[90px] text-[14px]" />
        {forCoach ? <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="h-9 text-[14px]" /> : null}
        {picked.length ? (
          <label className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
            <Checkbox checked={rights} onCheckedChange={(v) => setRights(v === true)} className="mt-0.5" />
            <span>{s.rightsText}</span>
          </label>
        ) : null}
        <Button className="w-full" disabled={!canSend} loading={busy} onClick={send}>
          Send
        </Button>
        {sent ? (
          <p className="flex items-center justify-center gap-1.5 text-[13px] text-success">
            <Check className="h-4 w-4" /> {sent} sent. You can add more any time with this link.
          </p>
        ) : null}
      </div>
    </Shell>
  );
}

function ShareQuestion({ q, onAnswer }: { q: { id: string; text: string; why: string | null; answer: any }; onAnswer: (v: { value: string; number?: number | null; date?: string | null }) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [num, setNum] = useState("");
  const [date, setDate] = useState("");
  const [other, setOther] = useState(false);
  const go = async (v: { value: string; number?: number | null; date?: string | null }) => {
    setBusy(v.value);
    try {
      await onAnswer(v);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save");
    } finally {
      setBusy(null);
    }
  };
  const opts: Array<{ value: string; label: string }> = (q.answer?.options ?? []).filter((o: any) => o.value !== "unknown");
  return (
    <div className="rounded-xl border border-warning/40 bg-warning/5 p-3">
      <p className="text-[14px] font-medium leading-snug">{q.text}</p>
      {q.why ? <p className="mt-0.5 text-[12.5px] text-muted-foreground">{q.why}</p> : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {q.answer?.kind === "date" ? (
          <>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 w-auto" />
            <Button size="sm" disabled={!date} loading={!!busy} onClick={() => go({ value: "date", date })}>
              Save
            </Button>
          </>
        ) : (
          opts.map((o) =>
            o.value === "other" ? (
              <Button key={o.value} size="sm" variant="outline" onClick={() => setOther(true)}>
                {o.label}
              </Button>
            ) : (
              <Button key={o.value} size="sm" variant="outline" className={cn("h-auto min-h-8 whitespace-normal py-1")} loading={busy === o.value} onClick={() => go({ value: o.value })}>
                {o.label}
              </Button>
            ),
          )
        )}
        {other ? (
          <>
            <Input inputMode="decimal" value={num} onChange={(e) => setNum(e.target.value)} placeholder="kg" className="h-8 w-20" />
            <Button size="sm" disabled={!(Number(num) > 0)} loading={!!busy} onClick={() => go({ value: "other", number: Number(num) })}>
              Save
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-[100svh] w-full max-w-md flex-col justify-center px-5 py-10" data-intel-share>
      <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-muted">
        <Trophy className="h-6 w-6" />
      </div>
      {children}
    </main>
  );
}
