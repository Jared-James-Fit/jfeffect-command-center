import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import {
  Cake,
  Check,
  MessageSquare,
  Eye,
  Pencil,
  User as UserIcon,
  Send,
} from "lucide-react";
import { calcAge, formatBirthdayShort } from "@/lib/basic-info";
import { toast } from "sonner";
import { BirthdayCardEditorDialog } from "@/components/birthday-card-editor";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { prefilledBirthdayMessage } from "@/lib/birthday-templates";
import { cn } from "@/lib/utils";
import { todayLocalISO } from "@/lib/today";

type Status = "today" | "overdue" | "upcoming" | "wished";

function computeBirthdayInfo(dob: string, ref: Date = new Date()) {
  const d = new Date(dob + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  const today = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const thisYearBd = new Date(today.getFullYear(), d.getMonth(), d.getDate());
  const dayMs = 86_400_000;
  if (thisYearBd.getTime() === today.getTime()) {
    return { year: today.getFullYear(), delta: 0 }; // today
  }
  if (thisYearBd < today) {
    // Past for this calendar year. Treat as overdue for this year, BUT for
    // sorting "upcoming" purposes we also know the *next* birthday is next year.
    const delta = Math.round((today.getTime() - thisYearBd.getTime()) / dayMs);
    return { year: today.getFullYear(), delta: -delta };
  }
  // upcoming this year
  const delta = Math.round((thisYearBd.getTime() - today.getTime()) / dayMs);
  return { year: today.getFullYear(), delta };
}

const UPCOMING_DAYS_DEFAULT = 30;

export function UpcomingBirthdaysWidget() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editorClientId, setEditorClientId] = useState<string | null>(null);
  const [previewClientId, setPreviewClientId] = useState<string | null>(null);
  const [sendForClient, setSendForClient] = useState<{
    id: string;
    name: string | null;
    firstName: string | null;
  } | null>(null);

  const { data: clients = [] } = useQuery({
    queryKey: ["upcoming-birthdays"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, first_name, full_name, preferred_name, date_of_birth, profile_picture_url, status")
        .eq("archived", false)
        .not("date_of_birth", "is", null);
      if (error) throw error;
      return data ?? [];
    },
  });

  const currentYear = new Date().getFullYear();
  const { data: wishes = [] } = useQuery({
    queryKey: ["birthday-wishes", currentYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_birthday_wishes")
        .select("client_id, birthday_year, wished_at")
        .gte("birthday_year", currentYear - 1);
      if (error) throw error;
      return data ?? [];
    },
  });

  const wishMap = new Map<string, number>();
  for (const w of wishes) wishMap.set(`${w.client_id}:${w.birthday_year}`, 1);

  const markWished = useMutation({
    mutationFn: async ({ clientId, year }: { clientId: string; year: number }) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("client_birthday_wishes")
        .insert({ client_id: clientId, birthday_year: year, wished_by: u.user?.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Marked as wished 🎉");
      qc.invalidateQueries({ queryKey: ["birthday-wishes", currentYear] });
    },
    onError: (e: any) => toast.error(e.message ?? "Could not save"),
  });

  type Row = {
    id: string;
    first_name: string | null;
    full_name: string | null;
    preferred_name: string | null;
    date_of_birth: string;
    profile_picture_url: string | null;
    status_label: string | null;
    delta: number;
    year: number;
    status: Status;
    turning: number | null;
    hasYear: boolean;
  };

  const rows: Row[] = clients
    .map((c): Row | null => {
      if (!c.date_of_birth) return null;
      const info = computeBirthdayInfo(c.date_of_birth);
      if (!info) return null;
      const wishedThisYear = wishMap.has(`${c.id}:${info.year}`);
      let status: Status;
      let year = info.year;
      let delta = info.delta;
      if (info.delta < 0) {
        // birthday already passed this year
        status = wishedThisYear ? "wished" : "overdue";
      } else if (info.delta === 0) {
        status = wishedThisYear ? "wished" : "today";
      } else {
        status = "upcoming";
      }
      // If DOB year is 1900-or-earlier sentinel or matches "no year" pattern,
      // skip age. Otherwise compute "age turning".
      const dobYear = Number(c.date_of_birth.slice(0, 4));
      const hasYear = !!dobYear && dobYear > 1900 && dobYear <= new Date().getFullYear();
      const age = hasYear ? calcAge(c.date_of_birth) : null;
      const turning = age != null ? age + (delta === 0 ? 0 : delta > 0 ? 1 : 0) : null;
      return {
        id: c.id,
        first_name: (c as any).first_name ?? null,
        full_name: c.full_name,
        preferred_name: c.preferred_name,
        date_of_birth: c.date_of_birth,
        profile_picture_url: c.profile_picture_url,
        status_label: (c as any).status ?? null,
        delta,
        year,
        status,
        turning,
        hasYear,
      };
    })
    .filter((r): r is Row => {
      if (!r) return false;
      // Always show overdue/today (until wished). Show upcoming within window. Hide already wished.
      if (r.status === "wished") return false;
      if (r.status === "overdue" || r.status === "today") return true;
      return r.delta <= UPCOMING_DAYS_DEFAULT;
    })
    .sort((a, b) => {
      // Order: overdue first (most overdue first), today, then upcoming ascending
      const rank = (s: Status) => (s === "overdue" ? 0 : s === "today" ? 1 : 2);
      const ra = rank(a.status);
      const rb = rank(b.status);
      if (ra !== rb) return ra - rb;
      if (a.status === "overdue") return a.delta - b.delta; // more negative first
      return a.delta - b.delta;
    });

  // One-time toast when there are birthdays today (deduped per browser per day).
  useEffect(() => {
    const todays = rows.filter((r) => r.status === "today");
    if (todays.length === 0) return;
    const key = `bday-toast:${todayLocalISO()}`;
    if (typeof window === "undefined" || sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    const names = todays
      .map((r) => r.preferred_name || r.first_name || r.full_name)
      .filter(Boolean)
      .join(", ");
    toast(`🎂 Birthday today: ${names}`, {
      description: "Customize their card or send a message from the dashboard.",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, rows.some((r) => r.status === "today")]);

  const editorRow = rows.find((r) => r.id === editorClientId) ?? null;
  const previewRow = rows.find((r) => r.id === previewClientId) ?? null;

  return (
    <Card className="border-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
          <Cake className="h-4 w-4" /> Upcoming Birthdays
        </h2>
        <span className="text-xs text-muted-foreground">
          Next {UPCOMING_DAYS_DEFAULT} days
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No upcoming birthdays in the next {UPCOMING_DAYS_DEFAULT} days.
        </div>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => {
            const name = r.preferred_name || r.full_name || r.first_name || "Unnamed";
            const firstName = r.first_name || r.preferred_name || name.split(" ")[0];
            const overdueDays = r.status === "overdue" ? Math.abs(r.delta) : 0;
            const isToday = r.status === "today";
            return (
              <li
                key={r.id}
                className={cn(
                  "group relative overflow-hidden rounded-xl border border-border bg-background/40 transition-colors hover:bg-background/70",
                  isToday && "border-primary/40 bg-primary/5",
                )}
              >
                {isToday && (
                  <span className="absolute inset-y-0 left-0 w-1 bg-primary" />
                )}
                <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <Link
                    to="/admin/clients/$id"
                    params={{ id: r.id }}
                    search={{ tab: "info" }}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <UserAvatar
                      src={r.profile_picture_url}
                      name={name}
                      size={44}
                      ring
                      expandable={false}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold group-hover:underline">
                          {name}
                        </span>
                        {r.status_label && (
                          <Badge variant="outline" className="hidden h-5 px-1.5 text-[10px] sm:inline-flex">
                            {r.status_label}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatBirthdayShort(r.date_of_birth)}
                        {r.turning != null ? ` · Turning ${r.turning}` : ""}
                        {" · "}
                        <span
                          className={cn(
                            isToday && "font-semibold text-primary",
                            r.status === "overdue" && "text-destructive",
                          )}
                        >
                          {isToday
                            ? "Today 🎂"
                            : r.status === "overdue"
                            ? `${overdueDays}d overdue`
                            : r.delta === 1
                            ? "Tomorrow"
                            : `${r.delta} days away`}
                        </span>
                      </div>
                    </div>
                  </Link>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 px-2 text-xs"
                      onClick={() =>
                        setSendForClient({ id: r.id, name, firstName })
                      }
                      title="Send birthday message"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Message</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 px-2 text-xs"
                      onClick={() => setEditorClientId(r.id)}
                      title="Customize birthday card"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Customize</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 px-2 text-xs"
                      onClick={() => setPreviewClientId(r.id)}
                      title="Preview birthday card"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Preview</span>
                    </Button>
                    <Link
                      to="/admin/clients/$id"
                      params={{ id: r.id }}
                      search={{ tab: "info" }}
                      title="View profile"
                    >
                      <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs">
                        <UserIcon className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Profile</span>
                      </Button>
                    </Link>
                    {(r.status === "today" || r.status === "overdue") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1 px-2 text-xs"
                        disabled={markWished.isPending}
                        onClick={() => markWished.mutate({ clientId: r.id, year: r.year })}
                        title="Mark as wished"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Wished</span>
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editorRow && (
        <BirthdayCardEditorDialog
          clientId={editorRow.id}
          firstName={editorRow.first_name || editorRow.preferred_name}
          fullName={editorRow.full_name}
          avatarSrc={editorRow.profile_picture_url}
          open={!!editorClientId}
          onOpenChange={(o) => !o && setEditorClientId(null)}
        />
      )}
      {previewRow && (
        <BirthdayCardEditorDialog
          clientId={previewRow.id}
          firstName={previewRow.first_name || previewRow.preferred_name}
          fullName={previewRow.full_name}
          avatarSrc={previewRow.profile_picture_url}
          open={!!previewClientId}
          onOpenChange={(o) => !o && setPreviewClientId(null)}
          previewOnly
        />
      )}
      {sendForClient && (
        <SendBirthdayMessageDialog
          clientId={sendForClient.id}
          clientName={sendForClient.name}
          firstName={sendForClient.firstName}
          open={!!sendForClient}
          onOpenChange={(o) => !o && setSendForClient(null)}
          onSent={() => {
            qc.invalidateQueries({ queryKey: ["birthday-wishes", currentYear] });
          }}
        />
      )}
    </Card>
  );
}

/* ----------------------- Send Birthday Message ----------------------- */

function SendBirthdayMessageDialog({
  clientId,
  clientName,
  firstName,
  open,
  onOpenChange,
  onSent,
}: {
  clientId: string;
  clientName: string | null;
  firstName: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSent?: () => void;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (open) setBody(prefilledBirthdayMessage(firstName));
  }, [open, firstName]);

  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("messages").insert({
        client_id: clientId,
        sender_id: u.user?.id ?? null,
        sender_role: "admin",
        body: body.trim(),
        message_type: "General",
      });
      if (error) throw error;
      toast.success(`Birthday message sent to ${firstName || clientName || "client"}`);
      onSent?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Could not send");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send Birthday Message</DialogTitle>
          <DialogDescription>
            Edit the message below and confirm to send. Nothing is sent automatically.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={7}
          className="font-[inherit]"
        />
        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
              navigate({ to: "/admin/messages", search: { client: clientId } });
            }}
          >
            Open full thread
          </Button>
          <Button onClick={send} disabled={sending || !body.trim()}>
            <Send className="mr-2 h-4 w-4" />
            {sending ? "Sending…" : "Send Message"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}