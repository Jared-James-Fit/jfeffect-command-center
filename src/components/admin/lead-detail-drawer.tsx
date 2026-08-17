import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { getCrmContact, addCrmNote, updateCrmContact } from "@/lib/crm.functions";
import { createFollowup } from "@/lib/coach-intel";
import {
  leadStage, displayLeadSource, displayLeadName, leadScoreDisplay,
  nextActionDisplay, NO_FOLLOW_UP,
} from "@/lib/crm-display";
import { LEAD_SCORE_DISCLAIMER } from "@/lib/lead-score-display";
import { Mail, Phone, Instagram, CalendarPlus, Check, X } from "lucide-react";

export function LeadDetailDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const fetchContact = useServerFn(getCrmContact);
  const addNote = useServerFn(addCrmNote);
  const update = useServerFn(updateCrmContact);

  const { data, isLoading } = useQuery({
    queryKey: ["crm", "contact", id],
    queryFn: () => fetchContact({ data: { id: id! } }),
    enabled: !!id,
  });

  const [note, setNote] = useState("");
  const [fuReason, setFuReason] = useState("");
  const [fuDate, setFuDate] = useState("");

  const c: any = data?.contact;
  const followups: any[] = data?.followups ?? [];
  const stage = leadStage(c?.lifecycle_stage);
  const score = leadScoreDisplay(c?.lead_score, c?.lead_scoring ?? c?.scoring);
  const next = nextActionDisplay({ followups, next_follow_up_at: c?.next_follow_up_at });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["crm"] });
  }

  async function saveFollowup() {
    if (!id || !fuReason.trim()) return;
    try {
      await createFollowup({ client_id: id, reason: fuReason.trim(), source: "crm", due_date: fuDate || null });
      toast.success("Follow-up added");
      setFuReason(""); setFuDate("");
      refresh();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  async function patch(p: any) {
    if (!id) return;
    try { await update({ data: { id, ...p } }); toast.success("Updated"); refresh(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  return (
    <Sheet open={!!id} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{c ? displayLeadName(c) : "Lead"}</SheetTitle>
        </SheetHeader>

        {isLoading && <div className="p-4 text-sm text-muted-foreground">Loading…</div>}

        {c && (
          <div className="space-y-4 pb-10">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{stage.label}</Badge>
              <Badge variant="outline" title={LEAD_SCORE_DISCLAIMER}>Lead Score {score.label}</Badge>
              <Badge variant="outline">{displayLeadSource(c.source)}</Badge>
            </div>

            <div className="flex flex-wrap gap-2">
              {c.email && <a href={`mailto:${c.email}`}><Button size="sm" variant="outline"><Mail className="mr-1 h-3.5 w-3.5" />Email</Button></a>}
              {c.phone && <a href={`tel:${c.phone}`}><Button size="sm" variant="outline"><Phone className="mr-1 h-3.5 w-3.5" />Call</Button></a>}
              {c.instagram && (
                <a href={`https://instagram.com/${String(c.instagram).replace(/^@/, "")}`} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline"><Instagram className="mr-1 h-3.5 w-3.5" />Instagram</Button>
                </a>
              )}
              <Button size="sm" variant="outline" onClick={() => patch({ lifecycle_stage: "won" })}><Check className="mr-1 h-3.5 w-3.5" />Mark Won</Button>
              <Button size="sm" variant="outline" onClick={() => patch({ lifecycle_stage: "lost" })}><X className="mr-1 h-3.5 w-3.5" />Mark Lost</Button>
              <Link to="/admin/crm/contacts/$id" params={{ id: c.id }}>
                <Button size="sm" variant="ghost">Full record →</Button>
              </Link>
            </div>

            <Section title="Contact">
              <Row label="Email" value={c.email} />
              <Row label="Phone" value={c.phone} />
              <Row label="Instagram" value={c.instagram} />
              <Row label="Source" value={displayLeadSource(c.source)} />
            </Section>

            <Section title="Lead summary">
              <Row label="Service interest" value={c.coaching_type ?? c.recommended_offer} />
              <Row label="Primary goal" value={c.goals} />
              <Row label="Stage" value={stage.label} />
              <Row label="Lead Score" value={score.label} />
              <div className="text-xs text-muted-foreground">{score.reason}</div>
              <div className="text-[11px] text-muted-foreground">{LEAD_SCORE_DISCLAIMER}</div>
            </Section>

            <Section title="Next action">
              <div className="text-sm">
                {next.isSet ? (
                  <>
                    <span className="font-medium">{next.label}</span>
                    {next.dueAt && <span className="text-muted-foreground"> · due {format(new Date(next.dueAt), "PP")}</span>}
                  </>
                ) : (
                  <span className="text-muted-foreground">{NO_FOLLOW_UP}</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input className="h-8 flex-1" placeholder="Follow-up reason…" value={fuReason} onChange={(e) => setFuReason(e.target.value)} />
                <Input className="h-8 w-[150px]" type="date" value={fuDate} onChange={(e) => setFuDate(e.target.value)} />
                <Button size="sm" disabled={!fuReason.trim()} onClick={saveFollowup}>
                  <CalendarPlus className="mr-1 h-3.5 w-3.5" />Add Follow-Up
                </Button>
              </div>
            </Section>

            <Section title="Timeline">
              <Timeline
                applications={data?.applications ?? []}
                activities={data?.activities ?? []}
                appointments={data?.appointments ?? []}
                contact={c}
              />
            </Section>

            <Section title="Notes">
              <Textarea rows={3} placeholder="Internal note…" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex justify-end">
                <Button size="sm" disabled={!note.trim()} onClick={async () => {
                  if (!id) return;
                  try { await addNote({ data: { id, note } }); setNote(""); toast.success("Note added"); refresh(); }
                  catch (e: any) { toast.error(e?.message ?? "Failed"); }
                }}>Save note</Button>
              </div>
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="space-y-2 p-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</div>
      {children}
    </Card>
  );
}
function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value?.trim() ? value : "—"}</span>
    </div>
  );
}

const MEANINGFUL = new Set([
  "note_added", "stage_changed", "converted", "payment", "offer_sent", "contacted", "call_booked",
]);

function Timeline({ applications, activities, appointments, contact }: any) {
  const items: { at: string; label: string }[] = [];
  for (const a of applications) items.push({ at: a.created_at, label: "Application submitted" });
  for (const ap of appointments.slice(0, 5)) items.push({ at: ap.starts_at, label: `${ap.appointment_type ?? "Appointment"} — ${ap.status}` });
  for (const act of activities) {
    if (!MEANINGFUL.has(act.activity_type)) continue;
    items.push({ at: act.created_at, label: act.title || String(act.activity_type).replace(/_/g, " ") });
  }
  if (contact.converted_to_client_at) items.push({ at: contact.converted_to_client_at, label: "Converted to client" });
  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  if (items.length === 0) return <div className="text-xs text-muted-foreground">No timeline events yet.</div>;
  return (
    <div className="space-y-1">
      {items.slice(0, 12).map((i, idx) => (
        <div key={idx} className="flex justify-between gap-3 text-xs">
          <span>{i.label}</span>
          <span className="shrink-0 text-muted-foreground">{formatDistanceToNow(new Date(i.at), { addSuffix: true })}</span>
        </div>
      ))}
    </div>
  );
}
