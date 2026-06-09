import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Cake, Check, CheckCircle2 } from "lucide-react";
import { calcAge, formatBirthdayShort } from "@/lib/basic-info";
import { toast } from "sonner";

const UPCOMING_WINDOW_DAYS = 30;

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
    // past this year — overdue for this year
    const delta = Math.round((today.getTime() - thisYearBd.getTime()) / dayMs);
    return { year: today.getFullYear(), delta: -delta };
  }
  // upcoming this year
  const delta = Math.round((thisYearBd.getTime() - today.getTime()) / dayMs);
  return { year: today.getFullYear(), delta };
}

export function UpcomingBirthdaysWidget() {
  const qc = useQueryClient();

  const { data: clients = [] } = useQuery({
    queryKey: ["upcoming-birthdays"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, full_name, preferred_name, date_of_birth, profile_picture_url")
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
    full_name: string | null;
    preferred_name: string | null;
    date_of_birth: string;
    profile_picture_url: string | null;
    delta: number;
    year: number;
    status: Status;
    turning: number | null;
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
        // upcoming — if already wished for this year (shouldn't normally happen since BD is future), treat as upcoming
        status = "upcoming";
      }
      const age = calcAge(c.date_of_birth);
      const turning = age != null ? age + (delta === 0 ? 0 : delta > 0 ? 1 : 0) : null;
      return {
        id: c.id,
        full_name: c.full_name,
        preferred_name: c.preferred_name,
        date_of_birth: c.date_of_birth,
        profile_picture_url: c.profile_picture_url,
        delta,
        year,
        status,
        turning,
      };
    })
    .filter((r): r is Row => {
      if (!r) return false;
      // Always show overdue/today (until wished). Show upcoming within window. Hide already wished.
      if (r.status === "wished") return false;
      if (r.status === "overdue" || r.status === "today") return true;
      return r.delta <= UPCOMING_WINDOW_DAYS;
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

  return (
    <Card className="border-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
          <Cake className="h-4 w-4" /> Upcoming Birthdays
        </h2>
        <span className="text-xs text-muted-foreground">Next {UPCOMING_WINDOW_DAYS} days + unwished</span>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No client birthdays to track right now.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => {
            const overdueDays = r.status === "overdue" ? Math.abs(r.delta) : 0;
            return (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                <Link
                  to="/admin/clients/$id"
                  params={{ id: r.id }}
                  search={{ tab: "info" }}
                  className="flex items-center gap-3 min-w-0 hover:underline"
                >
                  {r.profile_picture_url ? (
                    <img src={r.profile_picture_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div className="grid h-8 w-8 place-items-center rounded-full bg-secondary text-xs font-bold">
                      {(r.preferred_name || r.full_name || "?").slice(0, 1)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{r.preferred_name || r.full_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatBirthdayShort(r.date_of_birth)}
                      {r.turning != null ? ` · Turning ${r.turning}` : ""}
                    </div>
                  </div>
                </Link>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge
                    variant="outline"
                    className={
                      r.status === "overdue"
                        ? "border-destructive/50 bg-destructive/10 text-destructive font-bold"
                        : r.status === "today"
                        ? "border-primary/40 bg-primary/10 text-primary font-bold"
                        : r.delta <= 7
                        ? "border-warning/40 bg-warning/10 text-warning"
                        : "border-border"
                    }
                  >
                    {r.status === "overdue"
                      ? `Overdue · ${overdueDays}d`
                      : r.status === "today"
                      ? "🎂 Due Now"
                      : r.delta === 1
                      ? "Tomorrow"
                      : `${r.delta} days`}
                  </Badge>
                  {(r.status === "today" || r.status === "overdue") && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-xs"
                      disabled={markWished.isPending}
                      onClick={() =>
                        markWished.mutate({ clientId: r.id, year: r.year })
                      }
                    >
                      {markWished.isPending ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Wished
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}