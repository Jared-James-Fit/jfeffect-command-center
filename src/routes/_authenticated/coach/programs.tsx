import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, lazy, Suspense } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import { Plus, Search, Share2, Copy, Pencil, BookOpen, Inbox } from "lucide-react";
const ShareProgramSheet = lazy(() =>
  import("@/components/programs/share-program-sheet").then((m) => ({ default: m.ShareProgramSheet })),
);
import { DestinationBadges } from "@/components/programs/destination-badges";
import {
  listShares, listSharedWithMe, listMySubmissions,
  duplicateToMyLibrary, summarizeShares, destinationLabel,
  type TemplateShare,
} from "@/lib/programs/sharing";

export const Route = createFileRoute("/_authenticated/coach/programs")({
  component: CoachPrograms,
});

function CoachPrograms() {
  const [tab, setTab] = useState<"mine" | "shared" | "team" | "submissions">("mine");
  const { data: me } = useQuery({
    queryKey: ["auth-user"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  return (
    <>
      <PageHeader title="My Programs" subtitle="Your library, programs shared with you, and submissions" />
      <div className="p-6 md:p-8 space-y-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="mine">My Library</TabsTrigger>
            <TabsTrigger value="shared">Shared With Me</TabsTrigger>
            <TabsTrigger value="team">Team Library</TabsTrigger>
            <TabsTrigger value="submissions">My Submissions</TabsTrigger>
          </TabsList>

          <TabsContent value="mine" className="mt-4">
            {me && <MyLibrary userId={me.id} />}
          </TabsContent>
          <TabsContent value="shared" className="mt-4">
            {me && <SharedWithMe userId={me.id} />}
          </TabsContent>
          <TabsContent value="team" className="mt-4">
            {me && <TeamLibrary userId={me.id} />}
          </TabsContent>
          <TabsContent value="submissions" className="mt-4">
            {me && <MySubmissions userId={me.id} />}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function MyLibrary({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [shareTpl, setShareTpl] = useState<any | null>(null);
  const { data = [], isLoading } = useQuery({
    queryKey: ["coach-my-templates", userId, q],
    queryFn: async () => {
      let qb = supabase
        .from("pl_templates")
        .select("*")
        .eq("owner_user_id", userId)
        .eq("archived", false)
        .order("updated_at", { ascending: false });
      if (q) qb = qb.ilike("name", `%${q}%`);
      const { data, error } = await qb;
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <>
      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search my programs…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button size="sm" onClick={() => toast.info("Duplicate one from Team Library, or ask admin to create one for you.")}>
          <Plus className="mr-1 h-3 w-3" /> New
        </Button>
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
      ) : (data as any[]).length === 0 ? (
        <Card className="mt-4 p-12 text-center">
          <BookOpen className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            You don't own any programs yet. Duplicate one from the Team Library to get started.
          </p>
        </Card>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {(data as any[]).map((t) => (
            <CoachTemplateCard
              key={t.id}
              tpl={t}
              ownedByMe
              onShare={() => setShareTpl(t)}
              onChanged={() => qc.invalidateQueries({ queryKey: ["coach-my-templates"] })}
            />
          ))}
        </div>
      )}

      <ShareProgramSheet
        template={shareTpl}
        open={!!shareTpl}
        onOpenChange={(v) => !v && setShareTpl(null)}
        viewerRole="coach"
      />
    </>
  );
}

function SharedWithMe({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({
    queryKey: ["coach-shared-with-me", userId],
    queryFn: listSharedWithMe,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if ((data as any[]).length === 0) {
    return (
      <Card className="p-12 text-center">
        <Inbox className="mx-auto h-10 w-10 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">No programs have been shared directly with you yet.</p>
      </Card>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {(data as any[]).map((s) => (
        <CoachTemplateCard
          key={s.id}
          tpl={s.template}
          sharedVersion={s.shared_version}
          readOnly
          onChanged={() => qc.invalidateQueries({ queryKey: ["coach-shared-with-me"] })}
          onDuplicate={async () => {
            try {
              await duplicateToMyLibrary(s.template.id, userId);
              toast.success("Duplicated to My Library");
              qc.invalidateQueries({ queryKey: ["coach-my-templates"] });
            } catch (e: any) {
              toast.error(e.message ?? "Could not duplicate");
            }
          }}
        />
      ))}
    </div>
  );
}

function TeamLibrary({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({
    queryKey: ["coach-team-library"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pl_templates")
        .select("*")
        .eq("visibility", "team")
        .eq("archived", false)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if ((data as any[]).length === 0) {
    return (
      <Card className="p-12 text-center">
        <BookOpen className="mx-auto h-10 w-10 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">Team Library is empty.</p>
      </Card>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {(data as any[]).map((t) => (
        <CoachTemplateCard
          key={t.id}
          tpl={t}
          readOnly
          onDuplicate={async () => {
            try {
              await duplicateToMyLibrary(t.id, userId);
              toast.success("Duplicated to My Library");
              qc.invalidateQueries({ queryKey: ["coach-my-templates"] });
            } catch (e: any) {
              toast.error(e.message ?? "Could not duplicate");
            }
          }}
          onChanged={() => {}}
        />
      ))}
    </div>
  );
}

function MySubmissions({ userId }: { userId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["coach-my-submissions", userId],
    queryFn: () => listMySubmissions(userId),
  });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if ((data as any[]).length === 0) {
    return (
      <Card className="p-12 text-center">
        <Inbox className="mx-auto h-10 w-10 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">No submissions yet.</p>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {(data as any[]).map((s) => (
        <Card key={s.id} className="flex items-center gap-3 p-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{s.template?.name ?? "Untitled"}</div>
            <div className="text-xs text-muted-foreground">
              {destinationLabel(s.destination)} · v{s.shared_version} · {new Date(s.created_at).toLocaleDateString()}
            </div>
            {s.review_notes && (
              <div className="mt-1 text-xs italic text-muted-foreground">Admin: {s.review_notes}</div>
            )}
          </div>
          <SubmissionStatusBadge status={s.status} />
        </Card>
      ))}
    </div>
  );
}

function SubmissionStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "pending": return <Badge variant="secondary">Pending Approval</Badge>;
    case "changes_requested": return <Badge variant="secondary">Changes Requested</Badge>;
    case "approved": return <Badge>Approved</Badge>;
    case "rejected": return <Badge variant="destructive">Rejected</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
}

function CoachTemplateCard({
  tpl,
  ownedByMe = false,
  readOnly = false,
  sharedVersion,
  onShare,
  onDuplicate,
  onChanged: _onChanged,
}: {
  tpl: any;
  ownedByMe?: boolean;
  readOnly?: boolean;
  sharedVersion?: number | null;
  onShare?: () => void;
  onDuplicate?: () => void;
  onChanged: () => void;
}) {
  const { data: shares = [] } = useQuery({
    queryKey: ["pl-template-shares", tpl.id],
    queryFn: () => listShares(tpl.id),
    enabled: ownedByMe,
  });
  const summary = summarizeShares(tpl, shares as TemplateShare[]);

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <div className="truncate font-bold">{tpl.name}</div>
        <div className="text-[11px] text-muted-foreground">
          v{tpl.payload_revision} · Updated {new Date(tpl.updated_at).toLocaleDateString()}
          {sharedVersion != null && <> · shared at v{sharedVersion}</>}
        </div>
      </div>
      <DestinationBadges summary={summary} ownerRole={tpl.owner_role} compact />
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {ownedByMe && (
          <>
            <Button size="sm" variant="outline" className="flex-1" asChild>
              <Link to="/admin/program-library/$templateId" params={{ templateId: tpl.id }}>
                <Pencil className="mr-1 h-3 w-3" /> Edit
              </Link>
            </Button>
            <Button size="sm" className="flex-1" onClick={onShare}>
              <Share2 className="mr-1 h-3 w-3" /> Share
            </Button>
          </>
        )}
        {readOnly && (
          <Button size="sm" className="flex-1" onClick={onDuplicate}>
            <Copy className="mr-1 h-3 w-3" /> Duplicate to My Library
          </Button>
        )}
      </div>
    </Card>
  );
}