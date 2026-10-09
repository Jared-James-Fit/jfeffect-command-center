import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronRight, Eye, FlaskConical, Loader2, Search, UserPlus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { listMembers } from "@/lib/members.functions";
import { copyPovFromMember, setPovPersona } from "@/lib/pov.functions";
import { ACCOUNT_TYPES } from "@/lib/membership";
import { useOpenMemberProfile } from "@/lib/open-member-profile";
import { setPovFlag } from "@/components/pov-quick-toggle";

export const MEMBERS_KEY = ["admin-members-all"];
const PAGE = 30;

type Member = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone?: string | null;
  account_type: string;
  status: string;
  subscription_status?: string | null;
  user_id: string | null;
  is_admin_sandbox?: boolean | null;
  current_period_end?: string | null;
  trial_end_at?: string | null;
  cancel_at?: string | null;
};

const BILLING_ISSUE = ["Past Due", "Payment Failed"];

const FILTERS: Array<{ key: string; label: string; test: (m: Member) => boolean }> = [
  { key: "all", label: "All", test: (m) => m.status !== "Archived" },
  { key: "jf", label: "JF Membership", test: (m) => m.account_type === "jf_member" && m.status !== "Archived" },
  { key: "trialing", label: "Trialing", test: (m) => m.subscription_status === "Trialing" },
  { key: "billing", label: "Billing issue", test: (m) => BILLING_ISSUE.includes(m.subscription_status ?? "") },
  { key: "app", label: "App", test: (m) => m.account_type === "app_member" && m.status !== "Archived" },
  { key: "program", label: "Program-only", test: (m) => m.account_type === "program_only" && m.status !== "Archived" },
  { key: "setup", label: "Not set up", test: (m) => !m.user_id && m.status !== "Archived" },
  { key: "deactivated", label: "Deactivated", test: (m) => m.status === "Deactivated" },
  { key: "archived", label: "Archived", test: (m) => m.status === "Archived" },
];

const PERSONAS = [
  { key: "app_member", label: "Member" },
  { key: "app_member_premium", label: "Premium" },
  { key: "program_only", label: "Program only" },
] as const;

const initials = (m: Member) =>
  (m.full_name || m.email || "?").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");

function statusLine(m: Member): { text: string; warn: boolean } {
  const type = (ACCOUNT_TYPES as Record<string, { label: string }>)[m.account_type]?.label ?? m.account_type;
  if (m.status !== "Active") return { text: `${type} · ${m.status}`, warn: false };
  if (m.account_type === "jf_member" && m.subscription_status) {
    return { text: `${type} · ${m.subscription_status}`, warn: BILLING_ISSUE.includes(m.subscription_status) };
  }
  return { text: type, warn: false };
}

/** Where "Back" in the member app returns to. */
const MEMBERS_HREF = "/admin/clients?kind=members";

/**
 * Every app member in one fast list: search, tap a filter, tap a name to
 * manage them, or "View as" to open the member app with their access. The
 * owner's own test member sits on top for trying the member experience.
 * Used on the Clients page (Members) and on /admin/members.
 */
export function MembersDirectory({ returnTo = MEMBERS_HREF }: { returnTo?: string }) {
  const listFn = useServerFn(listMembers);
  const personaFn = useServerFn(setPovPersona);
  const copyFn = useServerFn(copyPovFromMember);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const openMember = useOpenMemberProfile();
  const { user, role, viewOnly } = useAuth();
  // The member app preview runs on the admin's own test account (server: admin only).
  const canPreview = role === "admin" && !viewOnly;
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);
  const [persona, setPersona] = useState<(typeof PERSONAS)[number]["key"]>("app_member");

  const { data, isLoading, error } = useQuery({
    queryKey: MEMBERS_KEY,
    queryFn: () => listFn({ data: {} }) as Promise<{ members: Member[] }>,
    staleTime: 30_000,
  });
  const all = data?.members ?? [];
  const sandbox = all.find((m) => m.is_admin_sandbox && m.user_id === user?.id) ?? null;
  const members = useMemo(() => all.filter((m) => !m.is_admin_sandbox), [all]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, members.filter(f.test).length])), [members]);
  const shown = useMemo(() => {
    const test = FILTERS.find((f) => f.key === filter)?.test ?? FILTERS[0].test;
    const q = query.trim().toLowerCase();
    return members.filter((m) => test(m) && (!q || [m.full_name, m.email, m.phone].some((v) => (v ?? "").toLowerCase().includes(q))));
  }, [members, filter, query]);

  const enter = async (key: string, run: () => Promise<unknown>, flag: string, done: string) => {
    if (busy) return;
    setBusy(key);
    try {
      await run();
      setPovFlag(flag, returnTo);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["m-me"] }),
        qc.invalidateQueries({ queryKey: ["current-member-access"] }),
        qc.invalidateQueries({ queryKey: MEMBERS_KEY }),
      ]);
      toast.success(done);
      navigate({ to: "/m" });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't open the member app");
    } finally {
      setBusy(null);
    }
  };

  const openTest = () =>
    enter("test", () => personaFn({ data: { persona } as any }), persona, "Viewing the member app as your test member");
  const viewAs = (m: Member) => {
    const name = m.full_name || m.email || "This member";
    void enter(m.id, () => copyFn({ data: { memberId: m.id } }), `as:${name}`, `Showing the member app with ${name}'s access`);
  };

  return (
    <div className="space-y-3">
      {canPreview && (
        <Card className="border-emerald-500/30 bg-emerald-500/5 p-3.5">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <FlaskConical className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Your test member</div>
              <p className="text-xs text-muted-foreground">
                Try the member app the way members see it. It's a private test account on your login; members never see it.
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-1 rounded-xl border bg-background/60 p-1" role="group" aria-label="Test as">
            {PERSONAS.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={persona === p.key}
                onClick={() => setPersona(p.key)}
                className={cn(
                  "flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors",
                  persona === p.key ? "bg-emerald-600 text-white" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Button className="h-10 flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => void openTest()} disabled={!!busy}>
              {busy === "test" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Eye className="mr-1.5 h-4 w-4" />}
              Open member app
            </Button>
            <Button
              variant="outline"
              className="h-10"
              disabled={!sandbox}
              title={sandbox ? undefined : "Open the member app once to create it"}
              onClick={() => sandbox && openMember(sandbox.id)}
            >
              Manage
            </Button>
          </div>
        </Card>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }}
          placeholder="Search name, email or phone"
          className="h-10 pl-9"
          aria-label="Search members"
        />
      </div>

      <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-swipe-ignore>
        {FILTERS.filter((f) => f.key === "all" || f.key === filter || counts[f.key] > 0).map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => { setFilter(f.key); setLimit(PAGE); }}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
              filter === f.key ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground",
              f.key === "billing" && filter !== f.key && "border-rose-500/40 text-rose-600 dark:text-rose-400",
            )}
          >
            {f.label} <span className="tabular-nums opacity-70">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : error ? (
        <Card className="border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Couldn't load members: {(error as any)?.message}</Card>
      ) : shown.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">No members match.</Card>
      ) : (
        <Card className="divide-y overflow-hidden p-0">
          {shown.slice(0, limit).map((m) => {
            const line = statusLine(m);
            return (
              <div key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                <a
                  href={`/admin/members/${m.id}`}
                  onClick={(e) => openMember(m.id, { event: e })}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold">{initials(m)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{m.full_name || m.email || "Member"}</span>
                    <span className={cn("block truncate text-xs", line.warn ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
                      {line.text}
                      {!m.user_id && <span className="text-amber-600 dark:text-amber-400"> · Not set up</span>}
                    </span>
                  </span>
                </a>
                {canPreview && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 shrink-0 px-2.5"
                    onClick={() => viewAs(m)}
                    disabled={!!busy}
                    aria-label={`View the member app with ${m.full_name || m.email || "this member"}'s access`}
                  >
                    {busy === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                    <span className="ml-1 hidden text-xs sm:inline">View as</span>
                  </Button>
                )}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
            );
          })}
          {shown.length > limit && (
            <button type="button" onClick={() => setLimit((n) => n + PAGE)} className="w-full py-2.5 text-xs font-semibold text-primary hover:bg-muted/40">
              Show more ({shown.length - limit} left)
            </button>
          )}
        </Card>
      )}
    </div>
  );
}

/** Header button for adding a member, kept with the list it adds to. */
export function NewMemberButton() {
  return (
    <Button asChild size="sm" className="h-9">
      <Link to="/admin/members/new">
        <UserPlus className="mr-1.5 h-4 w-4" />
        <span className="hidden sm:inline">New member</span>
        <span className="sm:hidden">Add</span>
      </Link>
    </Button>
  );
}
