/**
 * A client's OpenIPF on their Training tab (Athlete setup → OpenIPF): the
 * profile linked and its meets, Remove with Add back, or, when none is linked,
 * what the monthly search found, Find on OpenIPF now, or a pasted link. Meet
 * bests can become their maxes from here too. Coaching clients only.
 */
import { useState } from "react";
import { ExternalLink, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { meetDay, parseProfileUrl, siteName, suggestionOrder } from "@/lib/openipf";
import {
  findOnOpenIpf, useOpenIpfLink, useOpenIpfRemove, useOpenIpfRestore, useOpenIpfStatus, useOpenIpfSuggestions,
} from "@/lib/openipf.queries";
import { useQueryClient } from "@tanstack/react-query";
import { SuggestionCard } from "@/components/openipf/openipf-review";
import { MeetBestsRow } from "@/components/openipf/meet-bests";

export function OpenIpfPanel({ clientId, firstName }: { clientId: string; firstName: string | null }) {
  const qc = useQueryClient();
  const status = useOpenIpfStatus(clientId);
  const suggestions = useOpenIpfSuggestions();
  const link = useOpenIpfLink();
  const remove = useOpenIpfRemove();
  const restore = useOpenIpfRestore();
  const [finding, setFinding] = useState(false);
  const [url, setUrl] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const who = firstName || "them";
  const s = status.data;
  const mine = (suggestions.data ?? []).filter((x) => x.client_id === clientId && x.status === "pending").sort(suggestionOrder);

  if (status.isLoading) return <div className="py-6 text-sm text-muted-foreground">Loading…</div>;
  if (status.isError) return <div className="py-6 text-sm text-destructive">Couldn't load their OpenIPF link.</div>;
  if (!s) return <div className="py-6 text-sm text-muted-foreground">OpenIPF isn't set up yet.</div>;
  if (!s.eligible) return <div className="py-6 text-sm text-muted-foreground">OpenIPF is for coaching clients.</div>;

  const profile = parseProfileUrl(s.url);
  const find = async () => {
    setFinding(true);
    try {
      const r = await findOnOpenIpf(clientId, () => void qc.invalidateQueries({ queryKey: ["openipf-suggestions"] }));
      await qc.invalidateQueries({ queryKey: ["openipf-suggestions"] });
      await qc.invalidateQueries({ queryKey: ["openipf-status", clientId] });
      if (!r.done) toast.message("Still looking. Anything found shows here and in Messages.");
      else if (r.suggestions.length) toast.success(`Found ${r.suggestions.length === 1 ? "a possible match" : `${r.suggestions.length} possible matches`}`);
      else toast.message(`No lifter by ${who === "them" ? "their" : `${who}'s`} name on OpenIPF or OpenPowerlifting`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't search");
    } finally {
      setFinding(false);
    }
  };
  const doLink = () =>
    link.mutate(
      { clientId, url },
      {
        onSuccess: () => {
          setUrl("");
          toast.success("Linked. Their meets are coming in.");
        },
        onError: (e: any) => toast.error(e?.message ?? "Couldn't link it"),
      },
    );
  const doRemove = () =>
    remove.mutate(
      { athleteId: s.athlete_id!, clientId },
      {
        onSuccess: (historyId) => {
          setConfirmRemove(false);
          toast.success("Taken off their profile", {
            action: { label: "Add back", onClick: () => restore.mutate({ historyId, clientId }, { onError: (e: any) => toast.error(e?.message ?? "Couldn't add it back") }) },
          });
        },
        onError: (e: any) => toast.error(e?.message ?? "Couldn't remove it"),
      },
    );

  return (
    <div className="space-y-4" data-openipf-panel>
      {s.linked && profile ? (
        <div className="rounded-xl border border-border/70 p-3" data-openipf-linked>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-medium">Linked to {siteName(profile.host)}</div>
              <a href={s.url!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground underline-offset-2 hover:underline">
                {profile.host.replace("https://www.", "")}/u/{profile.slug} <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </div>
            <Button size="sm" className="h-10" variant="outline" onClick={() => setConfirmRemove(true)} disabled={remove.isPending}>Remove</Button>
          </div>
          <p className="mt-2 text-[13px] text-muted-foreground">
            {s.meet_count} meet{s.meet_count === 1 ? "" : "s"}{s.last_meet ? ` · last ${meetDay(s.last_meet)}` : ""}
            {s.sync_status && s.sync_status !== "ok" ? ` · ${s.sync_status}` : ""}
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">Checked every day. A new meet shows in Messages with any records it set, and goes in the Hall of Strength.</p>
        </div>
      ) : (
        <>
          {mine.length > 0 && (
            <div className="space-y-2">
              {mine.map((x) => <SuggestionCard key={x.id} s={x} onOpenClient={() => {}} />)}
            </div>
          )}
          <div className="rounded-xl border border-border/70 p-3">
            <div className="text-sm font-medium">Not linked</div>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Every month your coaching clients are looked up by name. Look {who === "them" ? "them" : who} up now, or paste their profile link.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" className="h-10" variant="outline" onClick={find} disabled={finding} data-openipf-find>
                {finding ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
                {finding ? "Looking them up…" : "Find on OpenIPF"}
              </Button>
            </div>
            <div className="mt-3 flex gap-2">
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="openipf.org/u/…"
                inputMode="url"
                autoComplete="off"
                aria-label="OpenIPF profile link"
                className="h-10"
              />
              <Button size="sm" className="h-10" onClick={doLink} disabled={!parseProfileUrl(url) || link.isPending} loading={link.isPending}>Link</Button>
            </div>
          </div>
        </>
      )}

      {!s.linked && s.history.length > 0 && (
        <div className="space-y-1.5">
          {s.history.map((h) => (
            <div key={h.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/70 px-3 py-2 text-[13px]">
              <span className="min-w-0 truncate text-muted-foreground">
                Removed {meetDay(h.removed_at.slice(0, 10))} · {h.url.replace("https://www.", "")} · {h.meet_count} meet{h.meet_count === 1 ? "" : "s"}
              </span>
              <Button size="sm" className="h-10" variant="ghost" disabled={restore.isPending} onClick={() => restore.mutate({ historyId: h.id, clientId }, { onSuccess: () => toast.success("Added back"), onError: (e: any) => toast.error(e?.message ?? "Couldn't add it back") })}>
                Add back
              </Button>
            </div>
          ))}
        </div>
      )}

      <MeetBestsRow clientId={clientId} />

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Take OpenIPF off {who === "them" ? "their" : `${who}'s`} profile?</AlertDialogTitle>
            <AlertDialogDescription>
              The meets it added come off their profile and the Hall of Strength. Meets you entered yourself stay. It isn't suggested again, and you can add it back any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); doRemove(); }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
