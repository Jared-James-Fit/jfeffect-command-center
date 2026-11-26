/**
 * Re-create on a check-in's suggested reply (Nov 25 2026): one tap writes new
 * wording from what's stored (the week's assessment, or the recap, and their
 * answers), never a new recap; the menu beside it picks a style: Make
 * shorter, More like me, More direct, More supportive, Custom. Every version
 * is kept and can be shown again (Versions); nothing already sent in the
 * chat changes. Staff only.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, RotateCcw, History } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { recreateReplyFn, replyVersionsFn, pickReplyVersionFn } from "@/lib/autopilot/autopilot.functions";
import { STYLE_LABEL, type ReplyStyle } from "@/lib/autopilot/reply";
import { cn } from "@/lib/utils";

type Style = Exclude<ReplyStyle, "initial">;

export function ReplyRecreate({ checkinId, current }: { checkinId: string; current: string }) {
  const qc = useQueryClient();
  const recreate = useServerFn(recreateReplyFn);
  const listVersions = useServerFn(replyVersionsFn);
  const pick = useServerFn(pickReplyVersionFn);
  const [busy, setBusy] = useState<Style | null>(null);
  const [custom, setCustom] = useState<string | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const versions = useQuery({
    queryKey: ["autopilot", "reply-versions", checkinId],
    queryFn: () => listVersions({ data: { checkinId } }) as Promise<Array<{ id: string; version_no: number; style: string; body: string; words: number }>>,
    staleTime: 30_000,
    retry: 1,
  });
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["messenger-checkin", checkinId] }),
      qc.invalidateQueries({ queryKey: ["autopilot", "reply-versions", checkinId] }),
    ]);
  };
  const run = async (style: Style, note?: string) => {
    setBusy(style);
    try {
      await recreate({ data: { checkinId, style, custom: note ?? null } });
      setCustom(null);
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't write a new version. The current one is kept.");
    } finally {
      setBusy(null);
    }
  };
  const list = versions.data ?? [];
  return (
    <div className="relative ml-auto flex items-center normal-case tracking-normal" data-reply-recreate>
      <button
        type="button"
        onClick={() => void run("redo")}
        disabled={!!busy}
        className="inline-flex items-center gap-1 rounded-l-full px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/10 disabled:opacity-60"
        title="New wording from the same assessment"
      >
        <RotateCcw className={cn("h-3 w-3", busy && "animate-spin")} /> {busy ? "Writing…" : "Re-create"}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" disabled={!!busy} className="rounded-r-full px-1.5 py-0.5 text-primary hover:bg-primary/10 disabled:opacity-60" aria-label="Re-create options">
            <ChevronDown className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-xs">Re-create</DropdownMenuLabel>
          {(["shorter", "like_me", "direct", "supportive"] as const).map((s) => (
            <DropdownMenuItem key={s} onSelect={() => void run(s)}>
              {STYLE_LABEL[s]}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => setCustom("")}>{STYLE_LABEL.custom}…</DropdownMenuItem>
          {list.length > 1 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setShowVersions((v) => !v)}>
                <History className="mr-2 h-3.5 w-3.5" /> Versions ({list.length})
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {custom != null && (
        <div className="fixed inset-x-3 bottom-3 z-50 flex gap-2 rounded-xl border border-border bg-background p-2 shadow-lg sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-6 sm:w-80" data-reply-custom>
          <Input autoFocus value={custom} maxLength={400} placeholder="e.g. mention the deadlift PR first" onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && custom.trim()) void run("custom", custom); if (e.key === "Escape") setCustom(null); }} />
          <Button size="sm" disabled={!custom.trim() || !!busy} onClick={() => void run("custom", custom)}>Write</Button>
        </div>
      )}
      {showVersions && list.length > 1 && (
        <div className="fixed inset-x-3 bottom-3 z-50 max-h-[60dvh] overflow-y-auto rounded-xl border border-border bg-background p-2 shadow-lg sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-6 sm:w-96" data-reply-versions>
          <div className="mb-1 flex items-center justify-between px-1 text-xs font-semibold text-muted-foreground">
            Versions <button type="button" className="text-foreground" onClick={() => setShowVersions(false)}>Close</button>
          </div>
          <ul className="space-y-1">
            {list.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  className={cn("w-full rounded-lg p-2 text-left text-[13px] normal-case tracking-normal hover:bg-muted", v.body === current && "bg-muted")}
                  onClick={async () => {
                    try {
                      await pick({ data: { checkinId, versionId: v.id } });
                      setShowVersions(false);
                      await refresh();
                    } catch (e: any) {
                      toast.error(e?.message ?? "Couldn't switch");
                    }
                  }}
                >
                  <span className="block text-[11px] font-semibold text-muted-foreground">
                    v{v.version_no} · {v.style === "initial" ? "First" : v.style === "redo" ? "Re-created" : STYLE_LABEL[v.style as keyof typeof STYLE_LABEL] ?? v.style} · {v.words} words
                  </span>
                  <span className="line-clamp-3 font-normal text-foreground">{v.body}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
