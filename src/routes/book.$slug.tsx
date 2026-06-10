import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getBookingLinkPublic, computeAvailableSlots, bookSlotPublic } from "@/lib/booking-links.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar as CalendarIcon, Clock, CheckCircle2, Video } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/book/$slug")({ component: BookingPage });

function BookingPage() {
  const { slug } = Route.useParams();
  const getFn = useServerFn(getBookingLinkPublic);
  const slotsFn = useServerFn(computeAvailableSlots);
  const bookFn = useServerFn(bookSlotPublic);

  const { data: info, isLoading } = useQuery({ queryKey: ["public-link", slug], queryFn: () => getFn({ data: { slug } }) });
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "" });
  const [success, setSuccess] = useState<{ time: string; meet: string | null } | null>(null);

  const { data: slotData, isLoading: loadingSlots } = useQuery({
    queryKey: ["public-slots", slug, date],
    queryFn: () => slotsFn({ data: { slug, date } }),
    enabled: !!info,
  });

  const book = useMutation({
    mutationFn: () => bookFn({ data: { slug, starts_at: selected!, ...form } as any }),
    onSuccess: (r: any) => {
      const t = new Date(r.starts_at).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
      setSuccess({ time: t, meet: r.meet_link ?? null });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  if (!info) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="p-10 text-center max-w-md border-border bg-card"><h1 className="text-xl font-bold mb-2">Booking link not found</h1><p className="text-sm text-muted-foreground">This link may have been deactivated.</p></Card>
    </div>
  );

  if (success) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="p-10 text-center max-w-md border-border bg-card">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-400" />
        <h1 className="text-xl font-bold mb-2">You're booked</h1>
        <p className="text-sm text-muted-foreground mb-4">{success.time}</p>
        {success.meet && (
          <a href={success.meet} target="_blank" rel="noreferrer">
            <Button className="bg-gradient-primary"><Video className="mr-2 h-4 w-4" /> Join Google Meet</Button>
          </a>
        )}
        <p className="text-xs text-muted-foreground mt-4">A calendar invite was sent to your email.</p>
      </Card>
    </div>
  );

  const { link, coach } = info;
  const slots = (slotData?.slots ?? []) as Array<{ startISO: string; label: string }>;

  return (
    <div className="min-h-screen bg-background p-6 md:p-10">
      <div className="max-w-3xl mx-auto">
        <Card className="border-border bg-card p-6 md:p-8">
          <div className="mb-6">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{coach?.full_name}</div>
            <h1 className="text-2xl md:text-3xl font-bold mt-1">{link.name}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {link.duration_minutes} min</span>
              <span>{link.appointment_type}</span>
              <span>{link.timezone}</span>
            </div>
            {link.description && <p className="text-sm text-muted-foreground mt-3">{link.description}</p>}
          </div>

          <div className="grid md:grid-cols-[260px_1fr] gap-6">
            <div>
              <Label className="text-xs font-semibold mb-2 flex items-center gap-1"><CalendarIcon className="h-3 w-3" /> DATE</Label>
              <Input type="date" value={date} min={new Date().toISOString().slice(0,10)} onChange={(e) => { setDate(e.target.value); setSelected(null); }} />

              <Label className="text-xs font-semibold mt-4 mb-2 block">AVAILABLE TIMES</Label>
              {loadingSlots ? (
                <div className="text-xs text-muted-foreground">Loading…</div>
              ) : slots.length === 0 ? (
                <div className="text-xs text-muted-foreground">No times available. Try another day.</div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {slots.map((s) => (
                    <Button key={s.startISO} size="sm" variant={selected === s.startISO ? "default" : "outline"} onClick={() => setSelected(s.startISO)}>
                      {s.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div><Label>Your name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              {link.collect_phone && <div><Label>Phone (for SMS reminders)</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>}
              {link.collect_notes && <div><Label>Anything you want to share?</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} /></div>}
              <Button
                className="w-full bg-gradient-primary"
                disabled={!selected || !form.name || !form.email || book.isPending}
                onClick={() => book.mutate()}
              >
                {book.isPending ? "Booking…" : selected ? "Confirm booking" : "Pick a time first"}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}