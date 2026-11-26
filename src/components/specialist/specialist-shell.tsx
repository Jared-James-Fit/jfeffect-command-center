/**
 * A specialist's whole app: three tabs (Footage, Training, Performance), an
 * athlete picker only when there's more than one, and their own account.
 * Nothing else: no Crew, messages, Cleo, programming or admin.
 */
import { useEffect, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { BarChart3, ClipboardList, PlaySquare, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { FullPageLoader } from "@/components/full-page-loader";
import { QueryState } from "@/components/loading";
import { PageSkeleton } from "@/components/loading/skeletons";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SpecialistProvider, useSpecialist, useSpecialistHome } from "./specialist-context";
import { SpecialistSetup } from "./specialist-setup";

const TABS = [
  { to: "/specialist", label: "Footage", icon: PlaySquare, exact: true },
  { to: "/specialist/training", label: "Training", icon: ClipboardList, exact: false },
  { to: "/specialist/performance", label: "Performance", icon: BarChart3, exact: false },
] as const;

export function SpecialistLayout() {
  const { accountRole, loading, signOut } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading || !accountRole) return;
    // anyone else has their own app: never a specialist's screens
    if (accountRole !== "specialist") navigate({ to: "/", replace: true });
  }, [accountRole, loading, navigate]);
  const home = useSpecialistHome();
  if (loading || !accountRole || accountRole !== "specialist") return <FullPageLoader />;
  return (
    <div className="min-h-[100dvh] bg-background">
      <QueryState
        query={home}
        what="your account"
        skeleton={<PageSkeleton />}
        errorSize="page"
        className="mx-auto max-w-3xl px-4 pt-[max(1rem,env(safe-area-inset-top))]"
      >
        {(data) => {
          if (!data.me) {
            return (
              <Notice
                title="This login isn't set up for the team"
                detail="Ask Jared to send you a new invite."
                onSignOut={signOut}
              />
            );
          }
          if (data.me.status !== "active") {
            return (
              <Notice
                title="Your access is paused"
                detail="Ask Jared if you think this is a mistake."
                onSignOut={signOut}
              />
            );
          }
          if (data.me.needs.length)
            return <SpecialistSetup me={data.me} onDone={() => home.refetch()} />;
          return (
            <SpecialistProvider data={data} refresh={() => home.refetch()}>
              <Chrome>
                <Outlet />
              </Chrome>
            </SpecialistProvider>
          );
        }}
      </QueryState>
    </div>
  );
}

function Notice({
  title,
  detail,
  onSignOut,
}: {
  title: string;
  detail: string;
  onSignOut: () => Promise<void>;
}) {
  return (
    <div className="mx-auto mt-16 max-w-sm space-y-3 text-center">
      <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground" />
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{detail}</p>
      <Button variant="outline" onClick={() => void onSignOut()}>
        Sign out
      </Button>
    </div>
  );
}

function Chrome({ children }: { children: ReactNode }) {
  const { me, athletes, athlete, setAthleteId } = useSpecialist();
  const { pathname } = useLocation();
  const active = (t: (typeof TABS)[number]) =>
    t.exact ? pathname === t.to || pathname === `${t.to}/` : pathname.startsWith(t.to);
  return (
    <div className="pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-10">
      <header className="sticky top-0 z-30 -mx-4 border-b border-border bg-background px-4 pb-2 pt-1">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold leading-tight">JF Effect</div>
            <div className="truncate text-xs text-muted-foreground">{me?.title}</div>
          </div>
          {athletes.length > 1 && athlete ? (
            <Select value={athlete.clientId} onValueChange={setAthleteId}>
              <SelectTrigger className="h-9 w-auto max-w-[11rem]" aria-label="Athlete">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {athletes.map((a) => (
                  <SelectItem key={a.clientId} value={a.clientId}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : athlete ? (
            <div className="truncate text-sm font-medium">{athlete.name}</div>
          ) : null}
          <Link
            to={"/specialist/account" as any}
            className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-muted text-xs font-semibold"
            aria-label="Your account"
          >
            {me?.headshotUrl ? (
              <img src={me.headshotUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              (me?.displayName ?? "?").slice(0, 1)
            )}
          </Link>
        </div>
        <nav className="mt-2 hidden gap-1 md:flex" aria-label="Sections">
          {TABS.map((t) => (
            <Link
              key={t.to}
              to={t.to as any}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm",
                active(t)
                  ? "bg-secondary font-semibold text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="pt-4">
        {athlete || pathname.startsWith("/specialist/account") ? (
          children
        ) : (
          <div className="mx-auto mt-10 max-w-sm space-y-2 text-center">
            <h1 className="text-lg font-semibold">No athletes yet</h1>
            <p className="text-sm text-muted-foreground">
              Once Jared gives you an athlete (and they agree to share), their footage, training and
              numbers show here.
            </p>
          </div>
        )}
      </main>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="Sections"
      >
        <div className="mx-auto grid max-w-[560px] grid-cols-3">
          {TABS.map((t) => (
            <Link
              key={t.to}
              to={t.to as any}
              className={cn(
                "flex h-[50px] flex-col items-center justify-center gap-0.5 text-[10px]",
                active(t) ? "text-primary" : "text-muted-foreground",
              )}
            >
              <t.icon className="h-6 w-6" strokeWidth={active(t) ? 2.25 : 1.75} />
              {t.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

/** "Not shared": a category the owner turned off for this athlete. */
export function NotShared({ what }: { what: string }) {
  const { athlete } = useSpecialist();
  return (
    <div className="mx-auto mt-10 max-w-sm space-y-2 text-center">
      <h1 className="text-lg font-semibold">{what} isn't shared</h1>
      <p className="text-sm text-muted-foreground">
        {athlete?.firstName ?? "This athlete"}'s {what.toLowerCase()} isn't part of what you can
        see. Ask Jared if you need it.
      </p>
    </div>
  );
}
