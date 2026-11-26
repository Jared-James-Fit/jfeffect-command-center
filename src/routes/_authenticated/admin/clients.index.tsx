import { createFileRoute, Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { ChevronRight, ChevronDown, Copy, Plus, Star, Users, Utensils } from "lucide-react";
import { PackageShareButton } from "@/components/sales/package-share-dialog";
import { PACKAGES_PAGE_URL } from "@/lib/coaching-packages/packages";
import { useAuth } from "@/lib/auth";
import { listClientsDirectoryFn } from "@/lib/clients-directory.functions";
import { archiveClient } from "@/lib/clients.functions";
import type { DirectoryRow } from "@/lib/clients-directory.functions";
import { filtersFromSearch, matchFromSearch, type DirectoryFilterKey } from "@/lib/clients-directory-filters";
import { STATUS_META } from "@/components/clients/clients-status";
import { ClientToolbar } from "@/components/clients/client-toolbar";
import { RecentlyDeletedRow } from "@/components/account/recently-deleted";
import { HandlingDirectory } from "@/components/competition/prep/handling-directory";
import { ClientRow, ClientRowSkeleton } from "@/components/clients/client-row";
import { Pager } from "@/components/clients/pager";
import { AddClientDialog } from "@/components/clients/add-client-dialog";
import { listTeam } from "@/lib/staff-invites.functions";
import { MembersDirectory, NewMemberButton, realMemberCount, useAccountDirectory } from "@/components/members/members-directory";
import { StaffPage } from "@/route-pages/_authenticated/admin/staff";
import { AccountsSwitcher, KINDS, useSwipeBetween, type AccountKind } from "@/components/accounts/accounts-switcher";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { useClientStars } from "@/lib/client-stars";
import { arrangeStarred, pageOf, readWholeDirectory, starredModeFromSearch, type StarredMode } from "@/lib/clients-directory-starred";
import type { QuickViewClient } from "@/components/clients/workout-quick-view/quick-view";

// The workout quick view loads on first use (and quietly once the list is idle), never with the list.
const WorkoutQuickView = lazyWithRetry(() => import("@/components/clients/workout-quick-view/quick-view"));

const searchSchema = z.object({
  search:        fallback(z.string(),                                                       "").default(""),
  // Older single-filter spelling; still read so a bookmarked link works. The filters now live in `flags`.
  status:        fallback(z.enum(["all","needs_setup","needs_review","program_ending","payment_issues","no_payment","new_clients","missed_workouts","inactive"]), "all").default("all"),
  // Comma-separated filter keys, e.g. "no_contract,no_nutrition".
  flags:         fallback(z.string(),                                                       "").default(""),
  // With several filters: clients with any of them (default) or, with ?match=all, every one.
  match:         fallback(z.enum(["any","all"]).optional(),                                 undefined as any),
  coachingType:  fallback(z.string(),                                                       "all").default("all"),
  coachId:       fallback(z.string().uuid().optional(),                                     undefined as any),
  sort:          fallback(z.enum(["attention","recent","name","ending","activity"]),       "name").default("name"),
  page:          fallback(z.number().int().min(1),                                          1).default(1),
  size:          fallback(z.union([z.literal(15), z.literal(25), z.literal(50)]),           15).default(15),
  lifecycle:     fallback(z.enum(["active","archived","deactivated"]),                      "active").default("active"),
  // Which accounts the page lists (admins): coaching clients, app members, or the team.
  kind:          fallback(z.enum(["clients","members","team"]),                            "clients").default("clients"),
  // The coach's own stars: only them, or them first (clients-directory-starred.ts).
  starred:       fallback(z.enum(["only","first"]).optional(),                             undefined as any),
});

export const Route = createFileRoute("/_authenticated/admin/clients/")({
  validateSearch: zodValidator(searchSchema),
  component: ClientsDirectoryPage,
  pendingComponent: AdminRouteSkeleton,
});

function AdminRouteSkeleton() {
  return (
    <div className="space-y-4 p-3 sm:p-4 md:p-6">
      <div className="h-10 w-56 jf-skeleton rounded bg-muted" />
      <div className="h-14 w-full jf-skeleton rounded bg-muted" />
      <ul className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="h-16 w-full jf-skeleton rounded bg-muted" />
        ))}
      </ul>
    </div>
  );
}

function ClientsDirectoryPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/clients/" });
  const { role, viewOnly } = useAuth();
  const isAdmin = role === "admin";
  // Admins switch between every kind of account here; coaches see their clients.
  const kind: AccountKind = isAdmin ? search.kind ?? "clients" : "clients";
  // The directory's own key: the account kind and the starred view aren't its filters.
  const { kind: _kind, starred: _starred, ...clientSearch } = search;
  const starredMode: StarredMode | null = kind === "clients" ? starredModeFromSearch(search.starred) : null;
  const stars = useClientStars();
  const teamFn = useServerFn(listTeam);
  const { data: accounts } = useAccountDirectory(isAdmin);
  const { data: teamData } = useQuery({ queryKey: ["team-access"], enabled: isAdmin, queryFn: () => teamFn(), staleTime: 30_000 });
  const goKind = (k: AccountKind) =>
    navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, kind: k === "clients" ? undefined : k }), resetScroll: false });
  // Members is always there for admins: every account that isn't a coaching client lives there,
  // read from every login and record (admin_account_directory), so nobody falls between lists.
  const memberCount = realMemberCount(accounts?.rows);
  const kinds: AccountKind[] = KINDS;
  const swipe = useSwipeBetween(kinds.indexOf(kind), (i) => goKind(kinds[i]), kinds.length);
  const qc = useQueryClient();
  const listFn = useServerFn(listClientsDirectoryFn);
  const archiveFn = useServerFn(archiveClient);
  const [archiveTarget, setArchiveTarget] = useState<DirectoryRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [nutritionOpen, setNutritionOpen] = useState(true);
  useEffect(() => {
    try { setNutritionOpen(window.localStorage.getItem("jf:nutrition-directory-open") !== "false"); } catch { /* optional */ }
  }, []);

  const lifecycle = search.lifecycle ?? "active";
  const isActiveLifecycle = lifecycle === "active";
  const flags = useMemo(
    () => filtersFromSearch({ status: search.status, flags: search.flags }),
    [search.status, search.flags],
  );
  const match = matchFromSearch(search.match);

  const listInput = {
    search: search.search || "",
    flags,
    match,
    coachingType: search.coachingType,
    coachId: search.coachId ?? null,
    sort: search.sort,
    lifecycle,
    separateNutrition: !starredMode,
  };
  const paged = useQuery({
    queryKey: ["clients-directory", clientSearch],
    enabled: !starredMode,
    queryFn: () => listFn({ data: { ...listInput, page: search.page, size: search.size } }),
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
  // Starred: the whole list for these filters (one call for a coaching business), then only or first, paged here.
  const { page: _page, size: _size, ...wholeKey } = clientSearch;
  const whole = useQuery({
    queryKey: ["clients-directory", "whole", wholeKey],
    enabled: !!starredMode,
    queryFn: () => readWholeDirectory((page, size) => listFn({ data: { ...listInput, page, size } })),
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
  const data = useMemo(() => {
    if (!starredMode) return paged.data;
    if (!whole.data) return undefined;
    const arranged = arrangeStarred(whole.data.rows, stars.ids, starredMode);
    return { rows: pageOf(arranged, search.page, search.size), total: arranged.length, counts: whole.data.counts, nutritionRows: [] as DirectoryRow[] };
  }, [starredMode, paged.data, whole.data, stars.ids, search.page, search.size]);
  const active = starredMode ? whole : paged;
  const { isFetching, isError, refetch } = active;

  // The workout quick view: who's open is the address's (?peek=), so Back and Esc close it and the
  // list underneath (search, filters, page, scroll) never reloads.
  const router = useRouter();
  const rawSearch = useRouterState({ select: (st) => st.location.search as Record<string, unknown> });
  const peekId = kind === "clients" && typeof rawSearch?.peek === "string" ? (rawSearch.peek as string) : null;
  const pushedPeek = useRef(false);
  const goPeek = useCallback(
    (id: string | null, how: "push" | "replace") =>
      navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({ ...prev, peek: id ?? undefined }),
        replace: how === "replace",
        resetScroll: false,
      } as any),
    [navigate],
  );
  const openPeek = useCallback(
    (r: DirectoryRow) => {
      pushedPeek.current = true;
      void goPeek(r.id, "push");
    },
    [goPeek],
  );
  const closePeek = useCallback(() => {
    if (pushedPeek.current && router.history.canGoBack()) {
      pushedPeek.current = false;
      router.history.back();
    } else {
      void goPeek(null, "replace");
    }
  }, [goPeek, router]);
  // Their full profile (the page's overlay) in the drawer's place: Back from it lands on the list.
  const openProfileFromPeek = useCallback(
    (id: string, tab?: string) => {
      pushedPeek.current = false;
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({ ...prev, peek: undefined, clientId: id, clientTab: tab }),
        replace: true,
        resetScroll: false,
      } as any);
    },
    [navigate],
  );
  const peekClient = useMemo((): QuickViewClient | null => {
    if (!peekId) return null;
    const row = data?.rows.find((r) => r.id === peekId);
    const star = stars.list.find((s) => s.id === peekId);
    return {
      id: peekId,
      full_name: row?.full_name ?? star?.full_name ?? null,
      profile_picture_url: row?.profile_picture_url ?? star?.profile_picture_url ?? null,
    };
  }, [peekId, data?.rows, stars.list]);
  // Loaded once it's wanted, and kept mounted after, so closing slides out and reopening is instant.
  const [quickViewMounted, setQuickViewMounted] = useState(false);
  useEffect(() => {
    if (peekId) setQuickViewMounted(true);
  }, [peekId]);
  // the chunk, once the list is idle, so the first tap opens at once
  useEffect(() => {
    if (kind !== "clients" || role === "client") return;
    const t = window.setTimeout(() => void WorkoutQuickView.preload().catch(() => {}), 2500);
    return () => window.clearTimeout(t);
  }, [kind, role]);

  const { data: coaches = [] } = useQuery({
    queryKey: ["admin-coaches-mini"],
    enabled: isAdmin,
    queryFn: async () => (await supabase.from("coaches").select("id, full_name").eq("archived", false).order("full_name", { ascending: true })).data ?? [],
  });

  const counts = data?.counts;
  const total = data?.total ?? 0;
  const rows = data?.rows ?? [];
  const nutritionRows = data?.nutritionRows ?? [];
  const visibleTotal = total + nutritionRows.length;
  // A row names the client's coach only when there's more than one coach to tell apart.
  const showCoach = isAdmin && (coaches as unknown[]).length > 1;

  // Only surface a count next to the controls when the result set is
  // narrowed — the page heading already shows the active-client total.
  const hasOtherFilters = !!(
    search.search ||
    flags.length > 0 ||
    search.coachingType !== "all" ||
    search.coachId
  );
  const hasActiveFilters = hasOtherFilters || starredMode === "only";
  // With chips picked, the line under them says how many show.
  const resultLabel = !hasActiveFilters || flags.length > 0
    ? null
    : isFetching && !data
      ? "Loading…"
      : visibleTotal === 0
        ? "No matches"
        : `${visibleTotal} result${visibleTotal === 1 ? "" : "s"}`;

  const renderClientRow = (r: DirectoryRow) => (
    <ClientRow
                key={r.id}
                r={r}
                showCoach={showCoach}
                onArchive={isAdmin && isActiveLifecycle ? setArchiveTarget : undefined}
                onQuickView={openPeek}
                onQuickViewIntent={() => void WorkoutQuickView.preload().catch(() => {})}
                starred={stars.isStarred(r.id)}
                onToggleStar={stars.canStar ? () => stars.toggle({ id: r.id, full_name: r.full_name, profile_picture_url: r.profile_picture_url }) : undefined}
              />
  );

  const teamCount = teamData?.members.length;

  return (
    <>
      <PageHeader
        title={kind === "members" ? "Members" : kind === "team" ? "Team" : "Clients"}
        // The count is said once: on the Clients / Members / Team switcher for
        // admins, here for coaches (who don't get the switcher).
        subtitle={!isAdmin && counts ? `${counts.all} active` : undefined}
        // Phones: Add sits on the title's row, not a row of its own above it.
        actionsInline
        actions={
          isAdmin && !viewOnly && kind === "clients" ? (
            // Not an every-visit action, so a quiet + rather than the screen's red button.
            <Button variant="outline" size="sm" className="h-10 w-10 px-0 sm:w-auto sm:px-3" onClick={() => setAddOpen(true)} aria-label="Add client">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Add client</span>
            </Button>
          ) : isAdmin && !viewOnly && kind === "members" ? (
            <NewMemberButton />
          ) : null
        }
      />

      {isAdmin && (
        <AccountsSwitcher
          kind={kind}
          onChange={goKind}
          kinds={kinds}
          counts={{ clients: counts?.all, members: memberCount, team: teamCount }}
        />
      )}

      {/* Swipe left / right between Clients, Members and Team. On Clients a
          right swipe is still the app's "back". */}
      <div {...swipe} data-no-swipe-back={kind === "clients" ? undefined : ""} className="min-h-[60vh]">
      {kind === "members" ? (
        <div className="space-y-3 p-3 sm:p-4 md:p-6">
          <MembersDirectory />
          {/* accounts waiting out their 30 days, with Restore */}
          <RecentlyDeletedRow />
        </div>
      ) : kind === "team" ? (
        <div>
          <StaffPage embedded />
          <div className="mx-auto max-w-3xl px-4 pb-6 md:px-6">
            <Link to="/admin/team" search={{ tab: "people" } as any} className="flex items-center justify-between rounded-xl border bg-card px-4 py-3 text-sm font-semibold hover:bg-muted/40">
              Coaches and their clients <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </div>
        </div>
      ) : (
      <div className="space-y-3 p-3 sm:p-4 md:p-6">
        {/* Toolbar (search + filters + sort) — pinned near the top for
            fast lookups. Rendered BEFORE the analytics overview so the
            client list stays the primary focus on every viewport. */}
        <ClientToolbar
          starred={starredMode}
          starredCount={stars.canStar || stars.list.length ? stars.list.length : null}
          search={search.search}
          coachingType={search.coachingType}
          coachId={(search.coachId as string | undefined) ?? null}
          coaches={coaches as { id: string; full_name: string | null }[]}
          sort={search.sort}
          isAdmin={isAdmin}
          resultLabel={resultLabel}
          flags={flags}
          match={match}
          lifecycle={lifecycle}
          counts={counts}
          total={visibleTotal}
          loading={isFetching && !data}
        />

        {/* A quiet shortcut to the existing public catalogue; no new navigation or dashboard. */}
        {!viewOnly && (
          <div className="flex flex-wrap items-center justify-end gap-1">
            <PackageShareButton label="Services & packages" />
            <Button variant="ghost" size="sm" className="h-9 px-2 text-xs text-muted-foreground" onClick={async () => {
              try {
                await navigator.clipboard.writeText(PACKAGES_PAGE_URL);
                toast.success("Packages link copied");
              } catch {
                toast.error("Couldn't copy the link. Open Services & packages to share it.");
              }
            }}><Copy className="h-3.5 w-3.5" aria-hidden /> Copy link</Button>
          </div>
        )}
        {/* Handling stays on the same page but is no longer hidden under pagination. */}
        <HandlingDirectory search={search.search} lifecycle={lifecycle} renderClientRow={renderClientRow} starredOnly={starredMode === "only" ? stars.ids : undefined} />
        {nutritionRows.length > 0 && (
          <section className="rounded-2xl border border-border bg-card" data-nutrition-directory>
            <button type="button" aria-expanded={nutritionOpen || !!search.search} onClick={() => {
              const next = !nutritionOpen;
              setNutritionOpen(next);
              try { window.localStorage.setItem("jf:nutrition-directory-open", String(next)); } catch { /* optional */ }
            }} className="flex w-full items-center gap-3 px-4 py-3 text-left">
              <Utensils className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm font-medium">Nutrition coaching <span className="font-normal text-muted-foreground">{nutritionRows.length}</span></span>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${nutritionOpen || search.search ? "rotate-180" : ""}`} />
            </button>
            {(nutritionOpen || !!search.search) && <ul className="space-y-2 border-t border-border p-2">
              {nutritionRows.map(renderClientRow)}
            </ul>}
          </section>
        )}

        {isError ? (
          <Card className="p-8 text-center">
            <div className="mb-2 text-sm font-semibold text-destructive">Couldn't load clients</div>
            <Button onClick={() => refetch()} variant="outline" size="sm">Try again</Button>
          </Card>
        ) : !data && isFetching ? (
          <ul className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <ClientRowSkeleton key={i} />)}
          </ul>
        ) : rows.length === 0 && nutritionRows.length > 0 ? null : rows.length === 0 ? (
          <EmptyState
            starred={starredMode === "only"}
            hasFilters={starredMode === "only" ? hasOtherFilters : hasActiveFilters}
            flags={flags}
            match={match}
            lifecycle={lifecycle}
            // Back to the default view, but stay on the same tab (Active / Archived / Deactivated).
            onClear={() => navigate({ search: (prev: any) => ({ lifecycle: prev.lifecycle }), resetScroll: false })}
          />
        ) : (
          <ul className="space-y-2">
            {rows.map(renderClientRow)}
          </ul>
        )}

        {total > 0 && <Pager page={search.page} size={search.size} total={total} />}
        {/* accounts waiting out their 30 days, with Restore (iMessage's Recently Deleted) */}
        <RecentlyDeletedRow />
      </div>
      )}
      </div>

      {quickViewMounted && (
        <Suspense fallback={null}>
          <WorkoutQuickView
            client={peekClient}
            onClose={closePeek}
            onSwitch={(c) => void goPeek(c.id, "replace")}
            onOpenProfile={openProfileFromPeek}
          />
        </Suspense>
      )}

      <AddClientDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => qc.invalidateQueries({ queryKey: ["clients-directory"] })}
      />

      <AlertDialog open={!!archiveTarget} onOpenChange={(o) => !o && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiveTarget?.full_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The client will be hidden from the directory. You can restore them later from the Archive Manager.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!archiveTarget) return;
                const t = toast.loading("Archiving…");
                try {
                  await archiveFn({ data: { clientId: archiveTarget.id, archived: true } });
                  toast.success("Client archived", { id: t });
                  setArchiveTarget(null);
                  qc.invalidateQueries({ queryKey: ["clients-directory"] });
                } catch (e: any) {
                  toast.error(e?.message ?? "Failed to archive", { id: t });
                }
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function EmptyState({
  starred,
  hasFilters,
  flags,
  match,
  lifecycle,
  onClear,
}: {
  starred?: boolean;
  hasFilters: boolean;
  flags: DirectoryFilterKey[];
  match: "any" | "all";
  lifecycle: string;
  onClear: () => void;
}) {
  const labels = flags.map((k) => STATUS_META[k].label);
  const emptyTitle =
    lifecycle === "archived"
      ? "No archived clients"
      : lifecycle === "deactivated"
        ? "No deactivated clients"
        : "No clients yet";
  if (starred) {
    return (
      <Card className="flex flex-col items-center justify-center gap-3 p-8 text-center" data-starred-empty>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Star className="h-6 w-6" />
        </div>
        <div>
          <div className="text-base font-semibold">{hasFilters ? "No starred clients match these filters" : "No starred clients yet"}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Tap the star on a client to keep them here, one tap from their workout.
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onClear}>Show everyone</Button>
      </Card>
    );
  }
  return (
    <Card className="flex flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Users className="h-6 w-6" />
      </div>
      <div>
        <div className="text-base font-semibold">
          {hasFilters ? "No clients match these filters" : emptyTitle}
        </div>
        <div className="mt-1 text-sm text-muted-foreground">
          {hasFilters
            ? labels.length === 1
              ? `Nobody matches “${labels[0]}” right now. Try clearing it or adjusting your search.`
              : labels.length > 1
                ? match === "all"
                  ? `Nobody has all of: ${labels.join(", ")}. Switch Match to Any, or remove one.`
                  : `Nobody has any of: ${labels.join(", ")} right now.`
                : "Try clearing filters or adjusting your search."
            : lifecycle === "active"
              ? "Add your first client to get started."
              : "Nothing here right now."}
        </div>
      </div>
      {hasFilters ? (
        <Button variant="outline" size="sm" onClick={onClear}>Clear filters</Button>
      ) : null}
    </Card>
  );
}
