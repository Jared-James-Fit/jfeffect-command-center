import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
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
import { UserPlus, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { listClientsDirectoryFn } from "@/lib/clients-directory.functions";
import { archiveClient } from "@/lib/clients.functions";
import type { DirectoryRow } from "@/lib/clients-directory.functions";
import { SummaryCards } from "@/components/clients/summary-cards";
import { ClientToolbar } from "@/components/clients/client-toolbar";
import { ClientRow, ClientRowSkeleton } from "@/components/clients/client-row";
import { Pager } from "@/components/clients/pager";
import type { StatusKey } from "@/components/clients/clients-status";
import { AddClientDialog } from "@/components/clients/add-client-dialog";

const searchSchema = z.object({
  search:        fallback(z.string(),                                                       "").default(""),
  status:        fallback(z.enum(["all","needs_setup","needs_review","program_ending","payment_issues","new_clients"]), "all").default("all"),
  coachingType:  fallback(z.string(),                                                       "all").default("all"),
  coachId:       fallback(z.string().uuid().optional(),                                     undefined as any),
  sort:          fallback(z.enum(["attention","recent","name","ending","activity"]),       "attention").default("attention"),
  page:          fallback(z.number().int().min(1),                                          1).default(1),
  size:          fallback(z.union([z.literal(15), z.literal(25), z.literal(50)]),           15).default(15),
});

export const Route = createFileRoute("/_authenticated/admin/clients/")({
  validateSearch: zodValidator(searchSchema),
  component: ClientsDirectoryPage,
});

function ClientsDirectoryPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/clients" });
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const qc = useQueryClient();
  const listFn = useServerFn(listClientsDirectoryFn);
  const archiveFn = useServerFn(archiveClient);
  const [archiveTarget, setArchiveTarget] = useState<DirectoryRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ["clients-directory", search],
    queryFn: () =>
      listFn({
        data: {
          search: search.search || "",
          status: search.status,
          coachingType: search.coachingType,
          coachId: search.coachId ?? null,
          sort: search.sort,
          page: search.page,
          size: search.size,
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

  const totalLabel = isFetching && !data
    ? "Loading…"
    : total === 0
      ? "No clients match"
      : `${total} client${total === 1 ? "" : "s"}`;

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle={
          counts ? `${counts.all} active client${counts.all === 1 ? "" : "s"}` : undefined
        }
        actions={
          isAdmin && (
            <Button className="h-10" onClick={() => setAddOpen(true)}>
              <UserPlus className="mr-2 h-4 w-4" />
              Add Client
            </Button>
          )
        }
      />

      <div className="space-y-4 p-3 sm:p-4 md:p-6">
        <SummaryCards counts={counts} active={search.status as StatusKey} loading={!data && isFetching} />

        <ClientToolbar
          search={search.search}
          coachingType={search.coachingType}
          coachId={(search.coachId as string | undefined) ?? null}
          coaches={coaches as { id: string; full_name: string | null }[]}
          sort={search.sort}
          isAdmin={isAdmin}
          totalLabel={totalLabel}
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
          <EmptyState hasFilters={!!(search.search || search.status !== "all" || search.coachingType !== "all" || search.coachId)} onClear={() => navigate({ search: () => ({}) })} />
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <ClientRow key={r.id} r={r} onArchive={isAdmin ? setArchiveTarget : undefined} />
            ))}
          </ul>
        )}

        {total > 0 && <Pager page={search.page} size={search.size} total={total} />}
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

function EmptyState({ hasFilters, onClear }: { hasFilters: boolean; onClear: () => void }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Users className="h-6 w-6" />
      </div>
      <div>
        <div className="text-base font-semibold">
          {hasFilters ? "No clients match these filters" : "No clients yet"}
        </div>
        <div className="mt-1 text-sm text-muted-foreground">
          {hasFilters ? "Try clearing filters or adjusting your search." : "Add your first client to get started."}
        </div>
      </div>
      {hasFilters ? (
        <Button variant="outline" size="sm" onClick={onClear}>Clear filters</Button>
      ) : null}
    </Card>
  );
}