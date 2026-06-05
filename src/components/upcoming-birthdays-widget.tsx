import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Cake } from "lucide-react";
import { calcAge, daysUntilBirthday, formatBirthdayShort } from "@/lib/basic-info";

const WINDOW_DAYS = 30;

export function UpcomingBirthdaysWidget() {
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

  const rows = clients
    .map((c) => {
      const days = daysUntilBirthday(c.date_of_birth);
      const age = calcAge(c.date_of_birth);
      return { ...c, days, turning: age != null ? age + (days === 0 ? 0 : 1) : null };
    })
    .filter((r) => r.days !== null && r.days <= WINDOW_DAYS)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));

  return (
    <Card className="border-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
          <Cake className="h-4 w-4" /> Upcoming Birthdays
        </h2>
        <span className="text-xs text-muted-foreground">Next {WINDOW_DAYS} days</span>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No client birthdays in the next {WINDOW_DAYS} days.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
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
                    {formatBirthdayShort(r.date_of_birth!)} · Turning {r.turning}
                  </div>
                </div>
              </Link>
              <Badge
                variant="outline"
                className={
                  r.days === 0
                    ? "border-primary/40 bg-primary/10 text-primary font-bold"
                    : r.days! <= 7
                    ? "border-warning/40 bg-warning/10 text-warning"
                    : "border-border"
                }
              >
                {r.days === 0 ? "🎂 Today" : r.days === 1 ? "Tomorrow" : `${r.days} days`}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}