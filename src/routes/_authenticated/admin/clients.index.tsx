import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
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
import { ChevronRight, UserPlus, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { listClientsDirectoryFn } from "@/lib/clients-directory.functions";
import { archiveClient } from "@/lib/clients.functions";
import type { DirectoryRow } from "@/lib/clients-directory.functions";
import { filtersFromSearch, type DirectoryFilterKey } from "@/lib/clients-directory-filters";
import { STATUS_META } from "@/components/clients/clients-status";
import { ClientToolbar } from "@/components/clients/client-toolbar";
import { ClientRow, ClientRowSkeleton } from "@/components/clients/client-row";
import { Pager } from "@/components/clients/pager";
import { AddClientDialog } from "@/components/clients/add-client-dialog";
import { cn } from "@/lib/utils";
import { listMembers } from "@/lib/members.functions";
import { listTeam } from "@/lib/staff-invites.functions";
import { MembersDirectory, MEMBERS_KEY, NewMemberButton } from "@/components/members/members-directory";
import { StaffPage } from "@/route-pages/_authenticated/admin/staff";
import { AccountsSwitcher, KINDS, useSwipeBetween, type AccountKind } from "@/components/accounts/accounts-switcher";

function LifecycleTabs({ value }: { value: "active" | "archived" | "deactivated" }) {
  const navigate = useNavigate({ from: "/admin/clients/" });
  const OPTIONS: { key: "active" | "archived" | "deactivated"; label: string }[] = [
    { key: "active", label: "Active" },
    { key: "archived", label: "Archived" },
    { key: "deactivated", label: "Deactivated" },
  ];
  return (
    <div className="flex gap-1 rounded-xl border border-border bg-card/60 p-1 w-fit">
      {OPTIONS.map((o) => {
        const isActive = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() =>
              navigate({
                search: (prev: Record<string, unknown>) => ({
                  ...prev,
                  lifecycle: o.key === "active" ? undefined : o.key,
                  status: "all",
                  flags: undefined,
                  page: 1,
                }),
                resetScroll: false,
              })
            }
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/40",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const searchSchema = z.object({
  search:        fallback(z.string(),                                                       "").default(""),
  // Older single-filter spelling; still read so a bookmarked link works. The filters now live in `flags`.
  status:        fallback(z.enum(["all","needs_setup","needs_review","program_ending","payment_issues","no_payment","new_clients","missed_workouts","inactive"]), "all").default("all"),
  // Comma-separated filter keys, e.g. "no_contract,no_nutrition". A client must match all of them.
  flags:         fallback(z.string(),                                                       "").default(""),
  coachingType:  fallback(z.string(),                                                       "all").default("all"),
  coachId:       fallback(z.string().uuid().optional(),                                     undefined as any),
  sort:          fallback(z.enum(["attention","recent","name","ending","activity"]),       "name").default("name"),
  page:          fallback(z.number().int().min(1),                                          1).default(1),
  size:          fallback(z.union([z.literal(15), z.literal(25), z.literal(50)]),           15).default(15),
  lifecycle:     fallback(z.enum(["active","archived","deactivated"]),                      "active").default("active"),
  // Which accounts the page lists (admins): coaching clients, app members, or the team.
  kind:          fallback(z.enum(["clients","members","team"]),                            "clients").default("clients"),
});

export const Route = createFileRoute("/_authenticated/admin/clients/")({
  validateSearch: zodValidator(searchSchema),
  component: ClientsDirectoryPage,
  pendingComponent: AdminRouteSkeleton,
});

function AdminRouteSkeleton() {
  return (
    <div className="space-y-4 p-3 sm:p-4 md:p-6">
      <div className="h-10 w-56 animate-pulse rounded bg-muted" />
      <div className="h-14 w-full animate-pulse rounded bg-muted" />
      <ul className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="h-16 w-full animate-pulse rounded bg-muted" />
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
  const { kind: _kind, ...clientSearch } = search;
  const membersFn = useServerFn(listMembers);
  const teamFn = useServerFn(listTeam);
  const { data: membersData } = useQuery({
    queryKey: MEMBERS_KEY,
    enabled: isAdmin,
    queryFn: () => membersFn({ data: {} }) as Promise<{ members: Array<{ is_admin_sandbox?: boolean | null; status: string }> }>,
    staleTime: 30_000,
  });
  const { data: teamData } = useQuery({ queryKey: ["team-access"], enabled: isAdmin, queryFn: () => teamFn(), staleTime: 30_000 });
  const goKind = (k: AccountKind) =>
    navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, kind: k === "clients" ? undefined : k }), resetScroll: false });
  const swipe = useSwipeBetween(KINDS.indexOf(kind), (i) => goKind(KINDS[i]));
  const qc = useQueryClient();
  const listFn = useServerFn(listClientsDirectoryFn);
  const archiveFn = useServerFn(archiveClient);
  const [archiveTarget, setArchiveTarget] = useState<DirectoryRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const lifecycle = search.lifecycle ?? "active";
  const isActiveLifecycle = lifecycle === "active";
  const flags = useMemo(
    () => filtersFromSearch({ status: search.status, flags: search.flags }),
    [search.status, search.flags],
  );

  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ["clients-directory", clientSearch],
    queryFn: () =>
      listFn({
        data: {
          search: search.search || "",
          flags,
          coachingType: search.coachingType,
          coachId: search.coachId ?? null,
          sort: search.sort,
          page: search.page,
          size: search.size,
          lifecycle,
        },
      }),
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });

  const { data: coaches = [] } = useQuery({
    queryKey: ["admin-coaches-mini"],
    enabled: isAdmin,
    queryFn: async () => (await supabase.from("coaches").select("id, full_name").eq("archived", false).order("full_name", { ascending: true })).data ?? [],
  });

  const counts = data?.counts;
  const total = data?.total ?? 0;
  const rows = data?.rows ?? [];

  // Only surface a count next to the controls when the result set is
  // narrowed — the page heading already shows the active-client total.
  const hasActiveFilters = !!(
    search.search ||
    flags.length > 0 ||
    search.coachingType !== "all" ||
    search.coachId
  );
  const resultLabel = !hasActiveFilters
    ? null
    : isFetching && !data
      ? "Loading…"
      : total === 0
        ? "No matches"
        : `${total} result${total === 1 ? "" : "s"}`;

  const memberCount = membersData?.members.filter((m) => !m.is_admin_sandbox && m.status !== "Archived").length;
  const teamCount = teamData?.members.length;

  return (
    <>
      <PageHeader
        title={kind === "members" ? "Members" : kind === "team" ? "Team" : "Clients"}
        subtitle={kind === "clients" && counts ? `${counts.all} active` : undefined}
        actions={
          isAdmin && !viewOnly && kind === "clients" ? (
            <Button size="sm" className="h-9" onClick={() => setAddOpen(true)}>
              <UserPlus className="mr-1.5 h-4 w-4" />
              <span className="hidden sm:inline">Add Client</span>
              <span className="sm:hidden">Add</span>
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
          counts={{ clients: counts?.all, members: memberCount, team: teamCount }}
        />
      )}

      {/* Swipe left / right between Clients, Members and Team. On Clients a
          right swipe is still the app's "back". */}
      <div {...swipe} data-no-swipe-back={kind === "clients" ? undefined : ""} className="min-h-[60vh]">
      {kind === "members" ? (
        <div className="p-3 sm:p-4 md:p-6"><MembersDirectory /></div>
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
        <LifecycleTabs value={lifecycle} />

        {/* Toolbar (search + filters + sort) — pinned near the top for
            fast lookups. Rendered BEFORE the analytics overview so the
            client list stays the primary focus on every viewport. */}
        <ClientToolbar
          search={search.search}
          coachingType={search.coachingType}
          coachId={(search.coachId as string | undefined) ?? null}
          coaches={coaches as { id: string; full_name: string | null }[]}
          sort={search.sort}
          isAdmin={isAdmin}
          resultLabel={resultLabel}
          flags={flags}
          counts={counts}
          total={total}
          loading={isFetching && !data}
        />

        {isError ? (
          <Card className="p-8 text-center">
            <div className="mb-2 text-sm font-semibold text-destructive">Couldn't load clients</div>
            <Button onClick={() => refetch()} variant="outline" size="sm">Try again</Button>
          </Card>
        ) : !data && isFetching ? (
          <ul className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <ClientRowSkeleton key={i} />)}
          </ul>
        ) : rows.length === 0 ? (
          <EmptyState
            hasFilters={hasActiveFilters}
            flags={flags}
            lifecycle={lifecycle}
            // Back to the default view, but stay on the same tab (Active / Archived / Deactivated).
            onClear={() => navigate({ search: (prev: any) => ({ lifecycle: prev.lifecycle }), resetScroll: false })}
          />
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <ClientRow key={r.id} r={r} onArchive={isAdmin && isActiveLifecycle ? setArchiveTarget : undefined} />
            ))}
          </ul>
        )}

        {total > 0 && <Pager page={search.page} size={search.size} total={total} />}
      </div>
      )}
      </div>

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
  hasFilters,
  flags,
  lifecycle,
  onClear,
}: {
  hasFilters: boolean;
  flags: DirectoryFilterKey[];
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
                ? `Nobody matches all of: ${labels.join(", ")}. Remove one to widen the list.`
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
