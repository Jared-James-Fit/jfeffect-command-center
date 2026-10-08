import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowUp, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ASSISTANT_NAME, ASSISTANT_SHORT } from "@/lib/business-books";
import { askSummer, clearSummer, getSummerMessages } from "@/lib/business-books.functions";

type Msg = { id: string; role: "user" | "assistant"; content: string; created_at: string };

const STARTERS = [
  "How much should I have set aside for taxes right now?",
  "What am I probably forgetting to deduct?",
  "What's left to fix before I send this to my accountant?",
  "List every payment over $500 this year.",
  "When are my next tax deadlines?",
  "Who still owes me money?",
];

// Small, safe Markdown subset (bold, lists, tables, headings) rendered as
// React elements; the model's text is never injected as HTML.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}

function SummerText({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={blocks.length} className="overflow-x-auto">
          <table className="w-full text-xs">
            {head && <thead><tr>{head.map((c, j) => <th key={j} className="border-b px-2 py-1 text-left font-semibold">{inline(c)}</th>)}</tr></thead>}
            <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} className="border-b border-border/50 px-2 py-1 align-top">{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
        i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={blocks.length} className={cn("space-y-0.5 pl-5", ordered ? "list-decimal" : "list-disc")}>
          {items.map((it, j) => <li key={j}>{inline(it)}</li>)}
        </List>,
      );
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    blocks.push(<p key={blocks.length} className={heading ? "font-semibold" : undefined}>{inline(heading ? heading[1] : line)}</p>);
    i++;
  }
  return <div className="space-y-2">{blocks}</div>;
}

export function SummerChat({ open, onOpenChange, year }: { open: boolean; onOpenChange: (o: boolean) => void; year: number }) {
  const qc = useQueryClient();
  const load = useServerFn(getSummerMessages);
  const ask = useServerFn(askSummer);
  const clear = useServerFn(clearSummer);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["summer-messages"],
    queryFn: () => load() as Promise<Msg[]>,
    enabled: open,
    staleTime: 60_000,
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pending, open]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || pending) return;
    setPending(message);
    setDraft("");
    try {
      const res = (await ask({ data: { message, year } })) as { user: Msg; assistant: Msg };
      qc.setQueryData<Msg[]>(["summer-messages"], (prev = []) => [...prev, res.user, res.assistant]);
    } catch (e: any) {
      setDraft(message);
      toast.error(e?.message ?? `${ASSISTANT_SHORT} couldn't answer that`);
    } finally {
      setPending(null);
    }
  };

  const reset = async () => {
    try {
      await clear();
      qc.setQueryData(["summer-messages"], []);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not clear");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        {/* The default header padding clears the sheet's Back pill. */}
        <SheetHeader className="border-b pb-3 pr-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-orange-500 text-white">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <SheetTitle className="text-base">{ASSISTANT_NAME}</SheetTitle>
                <SheetDescription className="text-xs">Your bookkeeper for {year}.</SheetDescription>
              </div>
            </div>
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" className="h-8 shrink-0 text-xs text-muted-foreground" onClick={() => void reset()}>
                <RotateCcw className="h-3.5 w-3.5 sm:mr-1" /><span className="sr-only sm:not-sr-only">New chat</span>
              </Button>
            )}
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm">
          {isLoading && <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
          {!isLoading && messages.length === 0 && !pending && (
            <div className="space-y-3">
              <p className="text-muted-foreground">
                Hi, I'm {ASSISTANT_SHORT}. Ask me what you owe, where something went, what you can still deduct, or what your accountant will need.
              </p>
              <div className="flex flex-wrap gap-2">
                {STARTERS.map((s) => (
                  <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border px-3 py-1.5 text-left text-xs hover:bg-accent">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[88%] rounded-2xl px-3 py-2", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>
                {m.role === "assistant" ? <SummerText text={m.content} /> : <p className="whitespace-pre-wrap">{m.content}</p>}
              </div>
            </div>
          ))}
          {pending && (
            <>
              <div className="flex justify-end">
                <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl bg-primary px-3 py-2 text-primary-foreground">{pending}</div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {ASSISTANT_SHORT} is going through the books…
              </div>
            </>
          )}
          <div ref={endRef} />
        </div>

        <form
          className="border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          onSubmit={(e) => { e.preventDefault(); void send(draft); }}
        >
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(draft); }
              }}
              rows={1}
              placeholder={`Ask ${ASSISTANT_SHORT}…`}
              className="max-h-32 min-h-10 resize-none"
              disabled={!!pending}
            />
            <Button type="submit" size="icon" className="h-10 w-10 shrink-0 rounded-full" disabled={!draft.trim() || !!pending} aria-label="Send">
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">Tax figures are estimates. {ASSISTANT_SHORT} reads your books but can't change them.</p>
        </form>
      </SheetContent>
    </Sheet>
  );
}
