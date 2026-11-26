import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronRight, Eye, FlaskConical, Heart, Loader2, Wrench } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { CLIENT_VIEW_HOME } from "@/lib/launch-home";
import { listMembers } from "@/lib/members.functions";
import { setPovPersona } from "@/lib/pov.functions";
import { useOpenMemberProfile } from "@/lib/open-member-profile";
import { setPovFlag } from "@/components/pov-quick-toggle";

const PERSONAS = [
  { key: "app_member", label: "Member" },
  { key: "app_member_premium", label: "Premium" },
  { key: "program_only", label: "Program only" },
] as const;
type Persona = (typeof PERSONAS)[number]["key"];

/**
 * Admin developer tools (Workspace Settings): the owner's own test account (the member app on
 * their own login, as a Member, Premium or Program-only member; no extra login, nobody else sees
 * it) and the disclosed virtual Crew accounts. Moved off Member Management, which lists real
 * people. To see a real person's account, use View as on their row: it's recorded.
 */
export function DeveloperToolsCard() {
  const { role, viewOnly } = useAuth();
  if (role !== "admin" || viewOnly) return null;
  return (
    <Card className="space-y-4 p-5 md:col-span-2" data-developer-tools>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted">
          <Wrench className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-base font-semibold">Developer tools</h2>
          <p className="text-sm text-muted-foreground">Test the member app on your own login, and manage the virtual Crew accounts.</p>
        </div>
      </div>
      <TestAccountTool />
      <Link
        to="/admin/virtual-accounts"
        className="flex min-h-11 items-center justify-between rounded-xl border bg-card px-4 py-3 text-sm font-semibold hover:bg-muted/40"
      >
        <span className="flex items-center gap-2">
          <Heart className="h-4 w-4" aria-hidden /> Virtual Crew accounts
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>
    </Card>
  );
}

function TestAccountTool() {
  const personaFn = useServerFn(setPovPersona);
  const membersFn = useServerFn(listMembers);
  const openMember = useOpenMemberProfile();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [persona, setPersona] = useState<Persona>("app_member");
  const [busy, setBusy] = useState(false);
  const { data } = useQuery({
    queryKey: ["admin-test-account"],
    queryFn: () => membersFn({ data: {} }) as Promise<{ members: Array<{ id: string; user_id: string | null; is_admin_sandbox?: boolean | null }> }>,
    staleTime: 60_000,
  });
  const sandbox = data?.members.find((m) => m.is_admin_sandbox && m.user_id === user?.id) ?? null;
  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await personaFn({ data: { persona } as any });
      setPovFlag(persona, "/admin/settings");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["m-me"] }),
        qc.invalidateQueries({ queryKey: ["current-member-access"] }),
      ]);
      toast.success("Viewing the member app as your test account");
      navigate({ to: CLIENT_VIEW_HOME });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't open the member app");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-xl border p-3.5" data-test-account>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <FlaskConical className="h-4 w-4" aria-hidden /> Your test account
      </div>
      <p className="text-xs text-muted-foreground">The member app on your own login. No extra account, and nobody else sees it.</p>
      <div className="flex gap-1 rounded-lg border bg-background p-1" role="group" aria-label="Test as">
        {PERSONAS.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={persona === p.key}
            onClick={() => setPersona(p.key)}
            className={cn(
              "min-h-9 flex-1 rounded-md px-2 text-xs font-semibold transition-colors",
              persona === p.key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button className="h-10 flex-1" onClick={() => void open()} disabled={busy}>
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Eye className="mr-1.5 h-4 w-4" />}
          Open member app
        </Button>
        <Button variant="outline" className="h-10" disabled={!sandbox} onClick={() => sandbox && openMember(sandbox.id)}>
          Manage
        </Button>
      </div>
    </div>
  );
}
