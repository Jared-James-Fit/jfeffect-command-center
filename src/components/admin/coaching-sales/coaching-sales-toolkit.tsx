import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, ArrowUp, Copy, History, ImageIcon, Pencil, Plus, Star, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { CardMenu, CardMenuItem, CardMenuSeparator } from "@/components/workout-day/card-menu";
import {
  duplicateCoachingPackage,
  listCoachingPackages,
  moveCoachingPackage,
  setCoachingPackageState,
  type AdminPackage,
} from "@/lib/coaching-packages/packages.functions";
import { priceText, shareLink, statusWord, toPublic } from "@/lib/coaching-packages/packages";
import { PackageEditorSheet } from "./package-editor-sheet";
import { PackageHistorySheet } from "./package-history-sheet";
import { EnrollmentsSheet } from "./enrollments-sheet";
import { ShareCards } from "./share-cards";
import { CoachingFunnelCard } from "./coaching-funnel-card";

export const PACKAGES_KEY = ["coaching-packages-admin"] as const;

/**
 * Sales → Coaching packages: the one place a package's words, price and what's
 * included are changed, and what the site and every pricing card read. Three
 * tabs: Packages (edit, put on or take off the site, order, history, who's on
 * each), Share cards (images and PDFs to send) and How people find it (the
 * site's anonymous funnel, interest apart from customers). Changing a package
 * never changes what a client pays: their sale and Stripe stay as they are.
 */
export default function CoachingSalesToolkit() {
  const [tab, setTab] = useState<"packages" | "cards" | "funnel">("packages");
  const [cardSlugs, setCardSlugs] = useState<string[] | null>(null);
  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6" data-coaching-toolkit>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-[14px] text-muted-foreground">
          What's on jfeffect.com and on every pricing card. Changing one never changes what a client pays.
        </p>
        <div className="inline-flex rounded-lg bg-muted p-1" role="tablist" aria-label="Coaching packages">
          {(
            [
              ["packages", "Packages"],
              ["cards", "Share cards"],
              ["funnel", "How people find it"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn(
                "h-9 rounded-md px-3.5 text-[14px] font-medium transition",
                tab === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      {tab === "packages" ? (
        <PackagesTab
          onShare={(slug) => {
            setCardSlugs([slug]);
            setTab("cards");
          }}
        />
      ) : tab === "cards" ? (
        <ShareCards initialSlugs={cardSlugs} />
      ) : (
        <CoachingFunnelCard />
      )}
    </div>
  );
}

function StatusChip({ p }: { p: AdminPackage }) {
  const word = statusWord(p);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium",
        word === "Live" && "bg-success/12 text-success",
        word === "Draft" && "bg-warning/15 text-warning-foreground dark:text-warning",
        (word === "Unlisted" || word === "Archived") && "bg-muted text-muted-foreground",
      )}
      data-package-status={word}
    >
      {word === "Live" && <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />}
      {word === "Live" ? "On the site" : word}
    </span>
  );
}

function PackagesTab({ onShare }: { onShare: (slug: string) => void }) {
  const qc = useQueryClient();
  const list = useServerFn(listCoachingPackages);
  const setState = useServerFn(setCoachingPackageState);
  const move = useServerFn(moveCoachingPackage);
  const duplicate = useServerFn(duplicateCoachingPackage);
  const q = useQuery({ queryKey: PACKAGES_KEY, queryFn: () => list() });
  const [editing, setEditing] = useState<AdminPackage | "new" | null>(null);
  const [history, setHistory] = useState<AdminPackage | null>(null);
  const [clients, setClients] = useState<AdminPackage | null>(null);
  const [confirm, setConfirm] = useState<{ p: AdminPackage; live: boolean } | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: PACKAGES_KEY });
  const act = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <div className="h-40 jf-skeleton rounded-2xl bg-muted" />;
  if (q.error) return <p className="text-[14px] text-destructive">{(q.error as Error).message}</p>;
  const canEdit = !!q.data?.canEdit;
  const all = q.data?.packages ?? [];
  const plans = all.filter((p) => p.kind !== "one_time" && p.status !== "archived");
  const calls = all.filter((p) => p.kind === "one_time" && p.status !== "archived");
  const archived = all.filter((p) => p.status === "archived");

  const row = (p: AdminPackage, i: number, group: AdminPackage[]) => (
    <li key={p.id} className="flex items-start gap-3 py-4" data-package-row={p.slug}>
      <button
        type="button"
        onClick={() => canEdit && setEditing(p)}
        className="min-w-0 flex-1 text-left"
        disabled={!canEdit}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[16px] font-semibold">{p.name}</span>
          <StatusChip p={p} />
          {p.recommended && (
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[12px] font-medium">
              <Star className="h-3 w-3" aria-hidden /> Recommended
            </span>
          )}
        </div>
        <p className="mt-1 text-[14px] text-muted-foreground">
          {[
            priceText(toPublic(p)),
            p.kind !== "free" && p.price_cents ? "+ tax" : null,
            p.included_calls ? `${p.included_calls} × ${p.call_minutes}-min calls a month` : null,
            p.activeClients ? `${p.activeClients} client${p.activeClients === 1 ? "" : "s"} on it` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {p.admin_note && <p className="mt-1 text-[13px] text-muted-foreground/80">{p.admin_note}</p>}
      </button>
      {canEdit && (
        <CardMenu name={p.name} buttonClassName="h-10 w-10 shrink-0 rounded-full" align="end" description="Package options">
          <CardMenuItem onSelect={() => setEditing(p)}>
            <Pencil className="mr-2 h-4 w-4" /> Edit and preview
          </CardMenuItem>
          {p.status === "active" && p.kind !== "free" && (
            <CardMenuItem
              onSelect={() => {
                void navigator.clipboard
                  .writeText(shareLink(p))
                  .then(() => toast.success("Application link copied"), () => toast.error("Couldn't copy"));
              }}
            >
              <Copy className="mr-2 h-4 w-4" /> Copy application link
            </CardMenuItem>
          )}
          <CardMenuItem onSelect={() => onShare(p.slug)}>
            <ImageIcon className="mr-2 h-4 w-4" /> Make a share card
          </CardMenuItem>
          <CardMenuItem onSelect={() => setClients(p)}>
            <Users className="mr-2 h-4 w-4" /> Clients on it
          </CardMenuItem>
          <CardMenuItem onSelect={() => setHistory(p)}>
            <History className="mr-2 h-4 w-4" /> History
          </CardMenuItem>
          <CardMenuSeparator />
          {p.status === "active" ? (
            p.is_public ? (
              <CardMenuItem onSelect={() => setConfirm({ p, live: false })}>Take off the site</CardMenuItem>
            ) : (
              <CardMenuItem onSelect={() => setConfirm({ p, live: true })}>Put on the site…</CardMenuItem>
            )
          ) : null}
          {p.status !== "active" && (
            <CardMenuItem onSelect={() => act.mutate(() => setState({ data: { id: p.id, status: "active" } }))}>
              Set to Active (not on the site)
            </CardMenuItem>
          )}
          {p.status === "active" && (
            <CardMenuItem onSelect={() => act.mutate(() => setState({ data: { id: p.id, status: "draft" } }))}>
              Back to draft
            </CardMenuItem>
          )}
          {p.kind !== "free" && p.status !== "archived" && !p.recommended && (
            <CardMenuItem onSelect={() => act.mutate(() => setState({ data: { id: p.id, recommended: true } }))}>
              Mark recommended
            </CardMenuItem>
          )}
          {p.recommended && (
            <CardMenuItem onSelect={() => act.mutate(() => setState({ data: { id: p.id, recommended: false } }))}>
              No longer recommended
            </CardMenuItem>
          )}
          <CardMenuItem onSelect={() => act.mutate(() => duplicate({ data: { id: p.id } }))}>
            Duplicate (for a custom offer)
          </CardMenuItem>
          {i > 0 && (
            <CardMenuItem onSelect={() => act.mutate(() => move({ data: { id: p.id, direction: "up" } }))}>
              <ArrowUp className="mr-2 h-4 w-4" /> Move up
            </CardMenuItem>
          )}
          {i < group.length - 1 && (
            <CardMenuItem onSelect={() => act.mutate(() => move({ data: { id: p.id, direction: "down" } }))}>
              <ArrowDown className="mr-2 h-4 w-4" /> Move down
            </CardMenuItem>
          )}
          <CardMenuSeparator />
          {p.status === "archived" ? (
            <CardMenuItem onSelect={() => act.mutate(() => setState({ data: { id: p.id, status: "draft" } }))}>
              Restore as draft
            </CardMenuItem>
          ) : (
            <CardMenuItem
              className="text-destructive"
              onSelect={() => act.mutate(() => setState({ data: { id: p.id, status: "archived" } }))}
            >
              Archive
            </CardMenuItem>
          )}
        </CardMenu>
      )}
    </li>
  );

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-semibold">Plans</h3>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setEditing("new")} data-new-package>
              <Plus className="mr-1 h-4 w-4" /> New package
            </Button>
          )}
        </div>
        <ul className="mt-1 divide-y divide-border">{plans.map((p, i) => row(p, i, plans))}</ul>
      </section>
      {calls.length > 0 && (
        <section>
          <h3 className="text-[16px] font-semibold">Single calls</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            One-time calls. Each needs a price and a booking type before it can go on the site.
          </p>
          <ul className="mt-1 divide-y divide-border">{calls.map((p, i) => row(p, i, calls))}</ul>
        </section>
      )}
      {archived.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-[14px] font-medium text-muted-foreground">Archived ({archived.length})</summary>
          <ul className="mt-1 divide-y divide-border">{archived.map((p, i) => row(p, i, archived))}</ul>
        </details>
      )}

      <PackageEditorSheet
        pkg={editing === "new" ? null : editing}
        open={!!editing}
        onClose={() => setEditing(null)}
        onSaved={() => refresh()}
      />
      <PackageHistorySheet pkg={history} onClose={() => setHistory(null)} />
      <EnrollmentsSheet pkg={clients} onClose={() => setClients(null)} onChanged={() => refresh()} />
      <PublishConfirm
        state={confirm}
        onClose={() => setConfirm(null)}
        onConfirm={(p, live) =>
          act.mutate(() => setState({ data: { id: p.id, is_public: live } }), {
            onSuccess: () => toast.success(live ? `${p.name} is on jfeffect.com` : `${p.name} is off the site`),
          })
        }
      />
    </div>
  );
}

function PublishConfirm({
  state,
  onClose,
  onConfirm,
}: {
  state: { p: AdminPackage; live: boolean } | null;
  onClose: () => void;
  onConfirm: (p: AdminPackage, live: boolean) => void;
}) {
  const p = state?.p;
  const live = !!state?.live;
  return (
    <AlertDialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{p ? (live ? `Put ${p.name} on the site?` : `Take ${p.name} off the site?`) : ""}</AlertDialogTitle>
          <AlertDialogDescription>
            {p && live
              ? `It shows on jfeffect.com and the coaching page right away, at ${priceText(toPublic(p))} plus tax. Nobody is charged and no client's price changes.`
              : "It comes off jfeffect.com and the coaching page. Clients on it keep it, and its link keeps working while it's active."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (p) onConfirm(p, live);
              onClose();
            }}
            data-confirm-publish
          >
            {live ? "Put it on the site" : "Take it off"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
