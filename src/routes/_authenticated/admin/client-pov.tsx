import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Eye, ArrowLeft, Search, UserX } from "lucide-react";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/client-pov")({
  head: () => ({ meta: [{ title: "Client POV — JF Effect" }] }),
  component: ClientPovPicker,
});

function ClientPovPicker() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const impersonation = useClientImpersonation();
  const [search, setSearch] = useState("");
  const canPov = role === "admin" || role === "coach";

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["clients-pov-picker"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, full_name, email, user_id, status, archived, coaching_type, assigned_coach_id")
        .eq("archived", false)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: canPov,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.full_name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q),
    );
  }, [clients, search]);

  const enterPov = (c: { id: string; user_id: string | null; full_name: string | null }) => {
    if (!c.user_id) {
      toast.error("This client has no account yet — send them a setup link first.");
      return;
    }
    impersonation.start(
      { id: c.id, user_id: c.user_id, full_name: c.full_name },
      typeof window !== "undefined" ? window.location.pathname + window.location.search : "/admin/client-pov",
    );
    navigate({ to: "/portal" });
  };

  if (!canPov) {
    return (
      <>
        <PageHeader title="Client POV" subtitle="Restricted" />
        <div className="p-6 md:p-8">
          <Card className="p-6 text-sm text-muted-foreground">
            Only admins and coaches can enter Client POV.
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Client POV"
        subtitle={`${clients.length} client${clients.length === 1 ? "" : "s"} · tap the eye to view their portal`}
        actions={
          <Link to="/admin">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
            </Button>
          </Link>
        }
      />
      <div className="space-y-4 p-6 md:p-8">
        <Card className="border-warning/30 bg-warning/5 p-4 text-sm">
          <div className="flex items-start gap-3">
            <Eye className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="text-muted-foreground">
              Entering Client POV shows you the portal exactly as that client sees it. A banner stays
              at the top so you can return to this page in one tap.
            </div>
          </div>
        </Card>

        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading clients…</p>
        ) : filtered.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">
            No clients match your search.
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((c) => {
              const hasAccount = !!c.user_id;
              return (
                <Card
                  key={c.id}
                  className="flex items-center justify-between gap-3 border-border bg-card p-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-sm font-semibold">
                        {c.full_name ?? "Unnamed"}
                      </div>
                      {c.status && (
                        <Badge variant="secondary" className="text-[10px] uppercase">
                          {c.status}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {c.email ?? "No email"}
                    </div>
                    {!hasAccount && (
                      <div className="mt-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-warning">
                        <UserX className="h-3 w-3" /> No account yet
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Link
                      to="/admin/clients/$id"
                      params={{ id: c.id }}
                      aria-label="Open client profile"
                    >
                      <Button size="sm" variant="ghost" className="h-9 px-2 text-xs">
                        Profile
                      </Button>
                    </Link>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-9 w-9 border-warning/40 bg-warning/10 text-warning hover:bg-warning/20 disabled:opacity-50"
                      onClick={() =>
                        enterPov({ id: c.id, user_id: c.user_id, full_name: c.full_name })
                      }
                      disabled={!hasAccount}
                      title={hasAccount ? `Enter ${c.full_name ?? "client"} POV` : "Client has no account yet"}
                      aria-label={`Enter Client POV for ${c.full_name ?? "client"}`}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}