import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Users, UserPlus, Send, ShieldCheck, Globe, Layers,
  Check, Trash2, Search,
} from "lucide-react";
import {
  listShares, publishToTeam, unpublishFromTeam, shareWithCoach,
  revokeCoachShare, submitForReview, listActiveCoaches,
  type ShareDestination,
} from "@/lib/programs/sharing";

type Tpl = {
  id: string;
  name: string;
  visibility: "private" | "team";
  owner_role: "admin" | "coach";
  owner_user_id: string | null;
  payload_revision: number;
};

export function ShareProgramSheet({
  template,
  open,
  onOpenChange,
  viewerRole,
}: {
  template: Tpl | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  viewerRole: "admin" | "coach";
}) {
  const qc = useQueryClient();
  const tid = template?.id ?? null;
  const { data: shares = [] } = useQuery({
    queryKey: ["pl-template-shares", tid],
    queryFn: () => (tid ? listShares(tid) : Promise.resolve([])),
    enabled: !!tid,
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["pl-template-shares", tid] });
    qc.invalidateQueries({ queryKey: ["pl-templates"] });
  };

  if (!template) return null;
  const teamShare = shares.find(
    (s) => s.destination === "team" && s.status !== "removed" && s.status !== "rejected",
  );
  const coachShares = shares.filter(
    (s) => s.destination === "coach" && s.status !== "removed" && s.status !== "rejected",
  );
  const pending = (d: ShareDestination) =>
    shares.find((s) => s.destination === d && (s.status === "pending" || s.status === "changes_requested"));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Share &amp; Publish</SheetTitle>
          <SheetDescription className="line-clamp-1">{template.name}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Team library */}
          <DestinationRow
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Team Library"
            audience="All active coaches in your organization"
            statusBadge={
              template.visibility === "team" ? (
                <Badge>Team Live</Badge>
              ) : pending("team_submission") ? (
                <Badge variant="secondary">Pending Approval</Badge>
              ) : (
                <Badge variant="outline">Private</Badge>
              )
            }
            primary={
              viewerRole === "admin" ? (
                template.visibility === "team" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      await unpublishFromTeam(template.id);
                      toast.success("Removed from Team Library");
                      invalidate();
                    }}
                  >
                    Unpublish
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={async () => {
                      await publishToTeam(template.id, template.payload_revision);
                      toast.success("Published to Team Library");
                      invalidate();
                    }}
                  >
                    Publish to Team
                  </Button>
                )
              ) : pending("team_submission") ? (
                <Badge variant="secondary">Awaiting Admin</Badge>
              ) : (
                <SubmitButton
                  templateId={template.id}
                  version={template.payload_revision}
                  destination="team_submission"
                  onDone={invalidate}
                />
              )
            }
          />

          {/* Coaches */}
          {viewerRole === "admin" && (
            <CoachShareRow
              template={template}
              shares={coachShares}
              onChange={invalidate}
            />
          )}

          {/* Membership submission */}
          <DestinationRow
            icon={<Users className="h-5 w-5" />}
            title="Membership Library"
            audience="App members with the required access level"
            statusBadge={
              pending("membership_submission") ? (
                <Badge variant="secondary">Pending Approval</Badge>
              ) : (
                <Badge variant="outline">Not Submitted</Badge>
              )
            }
            primary={
              viewerRole === "admin" ? (
                <Badge variant="outline" className="text-[10px]">
                  Publish via Membership tab (Phase 2)
                </Badge>
              ) : pending("membership_submission") ? (
                <Badge variant="secondary">Awaiting Admin</Badge>
              ) : (
                <SubmitButton
                  templateId={template.id}
                  version={template.payload_revision}
                  destination="membership_submission"
                  onDone={invalidate}
                />
              )
            }
          />

          {/* Public submission */}
          <DestinationRow
            icon={<Globe className="h-5 w-5" />}
            title="Public Library"
            audience="Anyone with the public link"
            statusBadge={
              pending("public_submission") ? (
                <Badge variant="secondary">Pending Approval</Badge>
              ) : (
                <Badge variant="outline">Not Submitted</Badge>
              )
            }
            primary={
              viewerRole === "admin" ? (
                <Badge variant="outline" className="text-[10px]">
                  Public pages — Phase 3
                </Badge>
              ) : pending("public_submission") ? (
                <Badge variant="secondary">Awaiting Admin</Badge>
              ) : (
                <SubmitButton
                  templateId={template.id}
                  version={template.payload_revision}
                  destination="public_submission"
                  onDone={invalidate}
                />
              )
            }
          />

          <Separator />
          <p className="text-[11px] text-muted-foreground">
            Current draft version: <strong>v{template.payload_revision}</strong>. Submissions and shares are pinned to this version.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DestinationRow({
  icon,
  title,
  audience,
  statusBadge,
  primary,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  audience: string;
  statusBadge: React.ReactNode;
  primary: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-secondary/50 p-2 text-foreground">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-semibold">{title}</div>
              <div className="text-xs text-muted-foreground">{audience}</div>
            </div>
            {statusBadge}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">{primary}</div>
          {children && <div className="mt-3">{children}</div>}
        </div>
      </div>
    </Card>
  );
}

function SubmitButton({
  templateId,
  version,
  destination,
  onDone,
}: {
  templateId: string;
  version: number;
  destination: "team_submission" | "membership_submission" | "public_submission";
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Send className="mr-1 h-3 w-3" /> Submit for Review
      </Button>
    );
  }
  return (
    <div className="w-full space-y-2">
      <Textarea
        rows={2}
        placeholder="Optional note for the admin reviewer…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={async () => {
            try {
              await submitForReview(templateId, destination, version, notes.trim() || null);
              toast.success("Submitted for review");
              setOpen(false);
              setNotes("");
              onDone();
            } catch (e: any) {
              toast.error(e.message ?? "Could not submit");
            }
          }}
        >
          Send
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setNotes(""); }}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function CoachShareRow({
  template,
  shares,
  onChange,
}: {
  template: Tpl;
  shares: any[];
  onChange: () => void;
}) {
  const [picker, setPicker] = useState(false);
  const [q, setQ] = useState("");
  const { data: coaches = [] } = useQuery({
    queryKey: ["active-coaches"],
    queryFn: listActiveCoaches,
    enabled: picker,
  });
  const sharedIds = useMemo(() => new Set(shares.map((s) => s.target_coach_id)), [shares]);
  const filtered = (coaches as any[]).filter((c) =>
    !q || (c.full_name ?? "").toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <DestinationRow
      icon={<UserPlus className="h-5 w-5" />}
      title="Coaches"
      audience="Share read-only access with specific coaches"
      statusBadge={
        shares.length > 0 ? (
          <Badge>{shares.length} {shares.length === 1 ? "Coach" : "Coaches"}</Badge>
        ) : (
          <Badge variant="outline">Not Shared</Badge>
        )
      }
      primary={
        <Button size="sm" variant={picker ? "secondary" : "outline"} onClick={() => setPicker((p) => !p)}>
          {picker ? "Close" : "Manage Sharing"}
        </Button>
      }
    >
      {shares.length > 0 && (
        <ul className="mb-2 space-y-1">
          {shares.map((s) => (
            <CoachShareItem key={s.id} share={s} onRemove={onChange} />
          ))}
        </ul>
      )}
      {picker && (
        <div className="space-y-2 rounded-md border bg-secondary/20 p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search coaches…"
              className="h-8 pl-7 text-xs"
            />
          </div>
          <ul className="max-h-48 overflow-y-auto">
            {filtered.map((c) => {
              const has = sharedIds.has(c.id);
              return (
                <li key={c.id} className="flex items-center justify-between px-1 py-1 text-sm">
                  <span className="truncate">{c.full_name}</span>
                  <Button
                    size="sm"
                    variant={has ? "secondary" : "default"}
                    disabled={has}
                    onClick={async () => {
                      try {
                        await shareWithCoach(template.id, c.id, template.payload_revision);
                        toast.success(`Shared with ${c.full_name}`);
                        onChange();
                      } catch (e: any) {
                        toast.error(e.message ?? "Could not share");
                      }
                    }}
                  >
                    {has ? <><Check className="mr-1 h-3 w-3" /> Shared</> : "Share"}
                  </Button>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-1 py-2 text-center text-xs text-muted-foreground">No coaches found.</li>
            )}
          </ul>
        </div>
      )}
    </DestinationRow>
  );
}

function CoachShareItem({ share, onRemove }: { share: any; onRemove: () => void }) {
  const { data: coach } = useQuery({
    queryKey: ["coach-name", share.target_coach_id],
    queryFn: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase
        .from("coaches")
        .select("full_name")
        .eq("id", share.target_coach_id)
        .single();
      return data;
    },
  });
  return (
    <li className="flex items-center justify-between rounded border bg-background px-2 py-1 text-sm">
      <span className="flex items-center gap-2">
        <Layers className="h-3 w-3 text-muted-foreground" />
        <span className="truncate">{(coach as any)?.full_name ?? "Coach"}</span>
        <Badge variant="outline" className="text-[10px]">v{share.shared_version}</Badge>
      </span>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={async () => {
          await revokeCoachShare(share.id);
          toast.success("Access removed");
          onRemove();
        }}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </li>
  );
}