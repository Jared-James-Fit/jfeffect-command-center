import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { PtSessionDialog } from "@/components/pt-session-dialog";
import { BookingTypeEditor } from "@/components/booking/booking-type-editor";
import { ShareBookingSheet, type ShareTarget } from "@/components/booking/share-booking-sheet";
import { GoogleCalendarPage } from "@/route-pages/_authenticated/admin/google-calendar";
import { GoogleSyncStatusCard } from "@/components/admin-calendar/google-sync-status";
import { useGoogleCalendarStatus } from "@/lib/calendar-sources";
import { cardAccent, fmtDuration } from "@/lib/booking-cards";
import { summarizeHours, type HoursWindow } from "@/lib/booking-slots";
import { useBookingTypes } from "@/components/booking/use-booking-types";
import {
  TYPE_TEMPLATES,
  bookingUrl,
  publicOrigin,
  shortPlace,
  type BookingType,
} from "@/lib/booking-types";
import { cn } from "@/lib/utils";

type Status = { label: string; tone: string };
function statusOf(t: BookingType): Status {
  if (!t.is_active) return { label: "Off", tone: "border-border text-muted-foreground" };
  if (!t.online_enabled)
    return { label: "In-app only", tone: "border-border text-muted-foreground" };
  if (!(t.hours ?? []).length)
    return { label: "No hours set", tone: "border-amber-500/40 bg-amber-500/10 text-amber-500" };
  return {
    label: "Taking bookings",
    tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
  };
}

/**
 * Calendar → Booking. Every booking type in one list: book a client in a tap,
 * or send the link so people book themselves from your hours. Google Calendar
 * settings sit at the bottom, since that's what keeps bookings from clashing.
 */
export function AdminBookingPanel() {
  const qc = useQueryClient();
  const { data: types = [], isLoading } = useBookingTypes();
  const { data: gcal } = useGoogleCalendarStatus();
  const [editor, setEditor] = useState<{
    initial: BookingType | null;
    prefill: Partial<BookingType> | null;
  } | null>(null);
  const [share, setShare] = useState<ShareTarget | null>(null);
  const [bookWith, setBookWith] = useState<BookingType | null>(null);
  const [deleteFor, setDeleteFor] = useState<BookingType | null>(null);
  const [googleOpen, setGoogleOpen] = useState(false);

  const { data: bookingClients = [] } = useQuery({
    queryKey: ["clients-min"],
    enabled: !!bookWith,
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select(
          "id, full_name, timezone, default_session_location, package_tracking_enabled, sessions_purchased, sessions_used",
        )
        .eq("archived", false)
        .order("full_name");
      return data ?? [];
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["booking-types-admin"] });
    qc.invalidateQueries({ queryKey: ["booking-cards"] });
  };
  const nextSortOrder = types.length ? Math.max(...types.map((t) => t.sort_order ?? 0)) + 10 : 10;
  const live = types.filter(
    (t) => t.is_active && t.online_enabled && (t.hours ?? []).length,
  ).length;

  const patch = async (t: BookingType, values: Partial<BookingType>, ok: string) => {
    const { error } = await (supabase as any).from("booking_cards").update(values).eq("id", t.id);
    if (error) return toast.error(error.message);
    toast.success(ok);
    refresh();
  };

  const duplicate = async (t: BookingType) => {
    const { id, hours, created_at: _c, updated_at: _u, slug: _s, ...rest } = t as any;
    const { data: row, error } = await (supabase as any)
      .from("booking_cards")
      .insert({
        ...rest,
        name: `${t.name} (copy)`,
        slug: null,
        online_enabled: false,
        sort_order: nextSortOrder,
      })
      .select("id")
      .single();
    if (error) return toast.error(error.message);
    if ((hours ?? []).length) {
      await (supabase as any)
        .from("booking_card_hours")
        .insert((hours as HoursWindow[]).map((h) => ({ booking_card_id: row.id, ...h })));
    }
    toast.success("Copied. Turn on online booking in the copy when it's ready.");
    refresh();
  };

  const move = async (t: BookingType, dir: -1 | 1) => {
    const idx = types.findIndex((x) => x.id === t.id);
    const other = types[idx + dir];
    if (!other) return;
    await Promise.all([
      (supabase as any)
        .from("booking_cards")
        .update({ sort_order: other.sort_order })
        .eq("id", t.id),
      (supabase as any)
        .from("booking_cards")
        .update({ sort_order: t.sort_order })
        .eq("id", other.id),
    ]);
    refresh();
  };

  const confirmDelete = async () => {
    const t = deleteFor;
    if (!t) return;
    const [{ count: sessions }, { count: appts }] = await Promise.all([
      supabase
        .from("pt_sessions")
        .select("id", { count: "exact", head: true })
        .eq("booking_card_id", t.id),
      (supabase as any)
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("booking_card_id", t.id),
    ]);
    const used = (sessions ?? 0) + (appts ?? 0);
    if (used > 0) {
      toast.error(
        `It's been booked ${used} time${used === 1 ? "" : "s"}, so it stays for the history. Turn it off instead.`,
      );
      setDeleteFor(null);
      return;
    }
    const { error } = await (supabase as any).from("booking_cards").delete().eq("id", t.id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    setDeleteFor(null);
    refresh();
  };

  const openNew = (prefill: Partial<BookingType> | null) => setEditor({ initial: null, prefill });

  return (
    <>
      <PageHeader
        title="Booking"
        subtitle="Book a client in a tap, or send a link so people book themselves from your open hours."
        actions={
          <Button size="sm" className="bg-gradient-primary font-bold" onClick={() => openNew(null)}>
            <Plus className="mr-1.5 h-4 w-4" /> New type
          </Button>
        }
      />
      <div className="space-y-4 p-3 sm:p-6 md:p-8">
        {/* What keeps it from double-booking */}
        <button
          type="button"
          onClick={() => setGoogleOpen((v) => !v)}
          className={cn(
            "flex w-full items-start gap-3 rounded-xl border p-3 text-left",
            gcal?.connected
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-amber-500/40 bg-amber-500/10",
          )}
        >
          {gcal?.connected ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          )}
          <span className="min-w-0 text-xs leading-snug">
            {gcal?.connected ? (
              <>
                <span className="font-bold">No double booking.</span> Open times skip your sessions,
                appointments and Google Calendar ({gcal.calendarName ?? "your app calendar"} + your
                main calendar). Busy all-day events block the day.
              </>
            ) : (
              <>
                <span className="font-bold">Google Calendar isn't connected.</span> Online booking
                only checks what's in the app. Tap to set it up.
              </>
            )}
          </span>
        </button>

        {isLoading ? (
          <Card className="p-6 text-sm text-muted-foreground">Loading…</Card>
        ) : types.length === 0 ? (
          <Card className="space-y-3 p-5 text-center">
            <p className="font-bold">Start with what you book most</p>
            <p className="text-sm text-muted-foreground">
              Pick one, check the hours, save. You get a link to send right away.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {TYPE_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => openNew(tpl.values)}
                  className="rounded-xl border border-border p-3 text-left transition hover:border-primary/50"
                >
                  <span className="block text-sm font-bold">{tpl.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{tpl.blurb}</span>
                </button>
              ))}
            </div>
          </Card>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {live ? `${live} taking online bookings` : "None taking online bookings yet"} ·{" "}
              {types.length} type{types.length === 1 ? "" : "s"}
            </p>
            <div className="grid gap-3 lg:grid-cols-2">
              {types.map((t, idx) => {
                const accent = cardAccent(t.color);
                const status = statusOf(t);
                const online = t.online_enabled && !!t.slug && t.is_active;
                const url = t.slug ? bookingUrl(publicOrigin(), t.slug) : null;
                return (
                  <Card
                    key={t.id}
                    className={cn(
                      "relative overflow-hidden p-3.5 pl-4",
                      !t.is_active && "opacity-60",
                    )}
                  >
                    <span className={cn("absolute inset-y-0 left-0 w-1", accent.bar)} />
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[15px] font-bold">{t.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {fmtDuration(t.duration_minutes)} · {shortPlace(t)}
                        </div>
                      </div>
                      <Badge variant="outline" className={cn("shrink-0 text-[10px]", status.tone)}>
                        {status.label}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge
                        variant="outline"
                        className={
                          t.uses_credit
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border text-muted-foreground"
                        }
                      >
                        {t.uses_credit ? "Uses a session" : "Free"}
                      </Badge>
                      {t.online_enabled && t.show_in_app && (
                        <Badge variant="outline" className="border-border text-muted-foreground">
                          In clients' app
                        </Badge>
                      )}
                    </div>
                    {t.online_enabled && (
                      <div className="mt-2 space-y-0.5">
                        <div className="text-xs text-foreground/90">
                          {summarizeHours(t.hours ?? [])}
                        </div>
                        {url && (
                          <div className="truncate font-mono text-[11px] text-muted-foreground">
                            {url.replace(/^https?:\/\//, "")}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {online ? (
                        <Button
                          size="sm"
                          className="h-9 bg-gradient-primary font-bold"
                          onClick={() => setShare({ name: t.name, slug: t.slug! })}
                        >
                          <Send className="mr-1.5 h-3.5 w-3.5" /> Send link
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9"
                          disabled={!t.is_active}
                          onClick={() => setEditor({ initial: t, prefill: null })}
                        >
                          <Play className="mr-1.5 h-3.5 w-3.5" /> Turn on online booking
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9"
                        disabled={!t.is_active}
                        onClick={() => setBookWith(t)}
                      >
                        <CalendarPlus className="mr-1.5 h-3.5 w-3.5" /> Book
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-9"
                        onClick={() => setEditor({ initial: t, prefill: null })}
                      >
                        <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-9 w-9 p-0"
                            aria-label={`More for ${t.name}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {url && t.online_enabled && (
                            <DropdownMenuItem asChild>
                              <a href={url} target="_blank" rel="noreferrer">
                                <ExternalLink className="mr-2 h-4 w-4" /> See booking page
                              </a>
                            </DropdownMenuItem>
                          )}
                          {t.online_enabled && (
                            <DropdownMenuItem
                              onClick={() =>
                                patch(
                                  t,
                                  { online_enabled: false },
                                  "Online booking paused. The link shows it's not taking bookings.",
                                )
                              }
                            >
                              <Pause className="mr-2 h-4 w-4" /> Pause online booking
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => duplicate(t)}>
                            <Copy className="mr-2 h-4 w-4" /> Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={idx === 0} onClick={() => move(t, -1)}>
                            <ArrowUp className="mr-2 h-4 w-4" /> Move up
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={idx === types.length - 1}
                            onClick={() => move(t, 1)}
                          >
                            <ArrowDown className="mr-2 h-4 w-4" /> Move down
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              patch(
                                t,
                                { is_active: !t.is_active },
                                t.is_active ? "Turned off everywhere" : "Turned on",
                              )
                            }
                          >
                            {t.is_active ? (
                              <EyeOff className="mr-2 h-4 w-4" />
                            ) : (
                              <Eye className="mr-2 h-4 w-4" />
                            )}
                            {t.is_active ? "Turn off" : "Turn on"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteFor(t)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </Card>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Add
              </span>
              {TYPE_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => openNew(tpl.values)}
                  className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          </>
        )}

        <Collapsible open={googleOpen} onOpenChange={setGoogleOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-left"
            >
              <span>
                <span className="block text-sm font-bold">Google Calendar</span>
                <span className="block text-[11px] text-muted-foreground">
                  Which calendar sessions go to, and sync status
                </span>
              </span>
              <ChevronDown
                className={cn("h-4 w-4 transition-transform", googleOpen && "rotate-180")}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-3">
            <GoogleCalendarPage embedded />
            <GoogleSyncStatusCard />
          </CollapsibleContent>
        </Collapsible>
      </div>

      <BookingTypeEditor
        open={!!editor}
        onOpenChange={(o) => !o && setEditor(null)}
        initial={editor?.initial ?? null}
        prefill={editor?.prefill ?? null}
        nextSortOrder={nextSortOrder}
        onSaved={(t) => {
          // A new type with online booking on: offer to send it straight away.
          if (!editor?.initial && t.online_enabled && t.slug)
            setShare({ name: t.name, slug: t.slug });
        }}
      />
      <ShareBookingSheet target={share} open={!!share} onOpenChange={(o) => !o && setShare(null)} />
      <PtSessionDialog
        open={!!bookWith}
        onOpenChange={(o) => !o && setBookWith(null)}
        clients={bookingClients as any}
        initialCard={bookWith as any}
      />
      <AlertDialog open={!!deleteFor} onOpenChange={(o) => !o && setDeleteFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteFor?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Only types that were never booked can be deleted. Its link stops working. If it's been
              used, turn it off instead so the history stays.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
