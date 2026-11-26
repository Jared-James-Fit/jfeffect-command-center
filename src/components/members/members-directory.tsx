import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  Eye,
  FlaskConical,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Repeat,
  Search,
  Star,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/user-avatar";
import { NameMarks } from "@/components/name-marks";
import { ClientNameLink } from "@/components/clients/client-name-link";
import { ChangePlanSheet } from "@/components/admin/intel/change-plan-sheet";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useClientStars } from "@/lib/client-stars";
import { useOpenMemberProfile } from "@/lib/open-member-profile";
import { useEnterClientPov } from "@/components/clients/use-enter-client-pov";
import { archiveClient } from "@/lib/clients.functions";
import {
  ago,
  FILTER_LABEL,
  filterCounts,
  ISSUE_WORDS,
  listMembers,
  memberAccounts,
  MEMBER_FILTERS,
  planWords,
  SORT_LABEL,
  statusChip,
  accountKey,
  type AccountRow,
  type MemberFilter,
  type MemberSort,
} from "@/lib/accounts/account-directory";
import { listAccountDirectoryFn, makeFreeMemberFn, setAccountClassFn } from "@/lib/accounts/account-directory.functions";
import { AccountSyncCard } from "@/components/members/account-sync-card";

export const ACCOUNT_DIRECTORY_KEY = ["admin-account-directory"];
/** Kept for callers that refreshed the old list. */
export const MEMBERS_KEY = ACCOUNT_DIRECTORY_KEY;
const PAGE = 30;

/** Every non-staff account, classified (one call; the list is small and filtered here). */
export function useAccountDirectory(enabled = true) {
  const listFn = useServerFn(listAccountDirectoryFn);
  return useQuery({
    queryKey: ACCOUNT_DIRECTORY_KEY,
    enabled,
    queryFn: () => listFn(),
    staleTime: 30_000,
  });
}

/** Real members (not coaching clients, test, demo or virtual accounts, nor closed ones). */
export function realMemberCount(rows: AccountRow[] | undefined): number | undefined {
  return rows ? listMembers(rows, { filter: "active", query: "", sort: "name" }).length : undefined;
}

const CHIP_TONE = {
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  muted: "border-border bg-muted text-muted-foreground",
} as const;

/**
 * Member Management: every account that isn't a coaching client, the way Client Management
 * lists clients. Free, paid and complimentary members, Premium, program-only accounts, logins
 * that never got an athlete record and disclosed virtual accounts, each with their photo, badge,
 * plan, status and last activity; search, filters, sort, stars, archive and quick actions; the
 * account's profile one tap away. Read from every login and record on the server
 * (admin_account_directory), so a new account shows the moment it exists.
 */
export function MembersDirectory() {
  const { role, viewOnly } = useAuth();
  const isAdmin = role === "admin";
  const [filter, setFilter] = useState<MemberFilter>("active");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<MemberSort>("activity");
  const [starredFirst, setStarredFirst] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const stars = useClientStars();
  const { data, isLoading, isError, refetch, isFetching } = useAccountDirectory();

  const rows = useMemo(
    () => (data?.rows ?? []).map((r) => (r.client_id ? { ...r, starred: stars.isStarred(r.client_id) } : r)),
    [data, stars],
  );
  const members = useMemo(() => memberAccounts(rows), [rows]);
  const counts = useMemo(() => filterCounts(members), [members]);
  const shown = useMemo(
    () => listMembers(rows, { filter, query, sort, starred: starredFirst ? "first" : null }),
    [rows, filter, query, sort, starredFirst],
  );

  return (
    <div className="space-y-3" data-members-directory>
      {isAdmin && !viewOnly && <AccountSyncCard />}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            placeholder="Search name, email, phone or @username"
            className="h-10 pl-9"
            aria-label="Search members"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as MemberSort)}
            className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm sm:flex-none"
            aria-label="Sort"
          >
            {(Object.keys(SORT_LABEL) as MemberSort[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABEL[k]}
              </option>
            ))}
          </select>
          {stars.canStar && (
            <Button
              variant="outline"
              className="h-10 shrink-0 gap-1.5 px-3"
              aria-pressed={starredFirst}
              onClick={() => setStarredFirst((v) => !v)}
              data-members-starred
            >
              <Star className={cn("h-4 w-4", starredFirst && "fill-foreground")} aria-hidden />
              <span className="text-sm">Starred first</span>
            </Button>
          )}
        </div>
      </div>

      <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-swipe-ignore>
        {MEMBER_FILTERS.filter((f) => f === "active" || f === filter || counts[f] > 0).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => {
              setFilter(f);
              setLimit(PAGE);
            }}
            className={cn(
              "min-h-9 shrink-0 rounded-full border px-3 text-xs font-semibold transition-colors",
              filter === f ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground",
            )}
            data-members-filter={f}
          >
            {FILTER_LABEL[f]} <span className="tabular-nums opacity-70">{counts[f]}</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <ul className="space-y-2" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 rounded-2xl border bg-card p-4">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            </li>
          ))}
        </ul>
      ) : isError ? (
        <Card className="p-6 text-center">
          <div className="mb-2 text-sm font-semibold text-destructive">Couldn't load members</div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            Try again
          </Button>
        </Card>
      ) : shown.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <Users className="h-6 w-6" aria-hidden />
          </span>
          <div className="text-base font-semibold">
            {query ? "No members match" : filter === "active" ? "No active members yet" : `Nobody under ${FILTER_LABEL[filter]}`}
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">
            {filter === "active"
              ? "Free and paid members show here the moment their account exists. Coaching clients are under Clients."
              : "Try another filter or clear the search."}
          </p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {shown.slice(0, limit).map((r) => (
            <MemberRow
              key={accountKey(r)}
              r={r}
              isAdmin={isAdmin && !viewOnly}
              starred={!!r.client_id && stars.isStarred(r.client_id)}
              onToggleStar={
                stars.canStar && r.client_id
                  ? () => stars.toggle({ id: r.client_id!, full_name: r.name, profile_picture_url: r.avatar_url })
                  : undefined
              }
            />
          ))}
          {shown.length > limit && (
            <li>
              <Button variant="ghost" className="h-10 w-full text-sm" onClick={() => setLimit((n) => n + PAGE)}>
                Show more ({shown.length - limit} left)
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function MemberRow({
  r,
  isAdmin,
  starred,
  onToggleStar,
}: {
  r: AccountRow;
  isAdmin: boolean;
  starred: boolean;
  onToggleStar?: () => void;
}) {
  const openMember = useOpenMemberProfile();
  const pov = useEnterClientPov();
  const [details, setDetails] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const chip = statusChip(r);
  const meta = [planWords(r), r.username ? `@${r.username}` : null, r.created_at ? `Joined ${ago(r.created_at)}` : null]
    .filter(Boolean)
    .join(" · ");
  const activity = [
    `Active ${ago(r.last_seen_at ?? r.last_sign_in_at)}`.replace("Active Never", "Never signed in"),
    r.workouts_30d > 0 ? `${r.workouts_30d} workout${r.workouts_30d === 1 ? "" : "s"} in 30 days` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const canView = pov.canPov && !!r.client_id && !!r.user_id && r.account_class !== "virtual";
  const open = (e?: React.MouseEvent) => {
    if (r.member_id) openMember(r.member_id, { event: e });
    else setDetails(true);
  };

  return (
    <li
      className={cn(
        "group relative grid gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-foreground/20",
        "xl:grid-cols-[minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] xl:items-center",
      )}
      data-member-row={r.account_class}
    >
      <div className="flex min-w-0 items-center gap-3">
        <UserAvatar src={r.avatar_url} name={r.name} size={40} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            {r.client_id ? (
              <ClientNameLink clientId={r.client_id} className="truncate text-[15px] font-semibold leading-snug hover:underline">
                {r.name}
              </ClientNameLink>
            ) : (
              <a
                href={r.member_id ? `/admin/members/${r.member_id}` : undefined}
                onClick={(e) => open(e)}
                className="cursor-pointer truncate text-[15px] font-semibold leading-snug hover:underline"
              >
                {r.name}
              </a>
            )}
            <NameMarks person={{ badge: r.badge, virtual: r.account_class === "virtual" }} size={14} />
          </span>
          <div className="truncate text-xs text-muted-foreground" data-member-meta>
            {meta}
          </div>
        </div>
        {onToggleStar ? (
          <button
            type="button"
            onClick={onToggleStar}
            aria-pressed={starred}
            aria-label={starred ? `Unstar ${r.name}` : `Star ${r.name}`}
            className={cn(
              "-my-1 -mr-1.5 grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors hover:bg-muted",
              starred ? "text-foreground" : "text-muted-foreground/50 hover:text-foreground",
            )}
          >
            <Star className={cn("h-[18px] w-[18px]", starred && "fill-foreground")} aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="-my-1 flex min-w-0 items-center gap-1.5" data-member-status>
        {chip ? (
          <span className={cn("inline-flex h-7 max-w-full items-center truncate rounded-full border px-2.5 text-xs font-medium", CHIP_TONE[chip.tone])}>
            {chip.label}
          </span>
        ) : (
          <span className="hidden text-xs text-muted-foreground xl:inline">{r.subscription_status && r.subscription_status !== "Free" ? r.subscription_status : ""}</span>
        )}
        {r.account_class === "test" || r.account_class === "demo" ? (
          <span className="inline-flex h-6 items-center rounded-full bg-muted px-2 text-[11px] font-medium text-muted-foreground">
            {r.account_class === "demo" ? "Demo" : "Test"}
          </span>
        ) : null}
      </div>

      <div className="truncate text-xs text-muted-foreground" data-member-activity>
        {activity}
      </div>

      <div className="flex items-center justify-end gap-1.5 max-xl:w-full">
        <Button variant="secondary" size="sm" className="h-10 min-w-0 flex-1 px-2.5 font-semibold sm:min-w-[7rem] xl:flex-none" onClick={(e) => (r.client_id ? undefined : open(e))} asChild={!!(r.client_id)}>
          {r.client_id ? <ClientNameLink clientId={r.client_id}>Open client</ClientNameLink> : <span>Open client</span>}
        </Button>
        {canView && (
          <Button
            variant="outline"
            size="sm"
            className="h-10 min-w-0 flex-1 px-2.5 font-semibold sm:min-w-[7rem] xl:flex-none"
            disabled={pov.busy}
            onClick={() => pov.enter(r.client_id!, { fallbackName: r.name })}
            aria-label={`See ${r.name}'s app as they see it`}
            data-member-view-as
          >
            {pov.busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            View as
          </Button>
        )}
        {isAdmin && <MemberMenu r={r} onPlan={() => setPlanOpen(true)} onDetails={() => setDetails(true)} />}
      </div>

      {details && <AccountDetails r={r} isAdmin={isAdmin} onClose={() => setDetails(false)} />}
      {planOpen && r.client_id && <ChangePlanSheet clientId={r.client_id} open={planOpen} onOpenChange={setPlanOpen} />}
    </li>
  );
}

function MemberMenu({ r, onPlan, onDetails }: { r: AccountRow; onPlan: () => void; onDetails: () => void }) {
  const qc = useQueryClient();
  const archiveFn = useServerFn(archiveClient);
  const classFn = useServerFn(setAccountClassFn);
  const refresh = () => qc.invalidateQueries({ queryKey: ACCOUNT_DIRECTORY_KEY });
  const archive = useMutation({
    mutationFn: (archived: boolean) => archiveFn({ data: { clientId: r.client_id!, archived } }),
    onSuccess: (_d, archived) => {
      toast.success(archived ? `${r.name} archived` : `${r.name} restored`);
      void refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't change that"),
  });
  const mark = useMutation({
    mutationFn: (accountClass: "real" | "test" | "demo" | "auto") => classFn({ data: { userId: r.user_id!, accountClass } }),
    onSuccess: () => {
      toast.success("Account updated");
      void refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't change that"),
  });
  const archived = r.lifecycle === "archived";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label={`More for ${r.name}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onSelect={onDetails}>
          <UserCheck className="mr-2 h-4 w-4" /> Account details
        </DropdownMenuItem>
        {r.client_id && (
          <DropdownMenuItem asChild>
            <Link to="/admin/messages" search={{ client: r.client_id } as any}>
              <MessageCircle className="mr-2 h-4 w-4" /> Message
            </Link>
          </DropdownMenuItem>
        )}
        {r.client_id && r.account_class !== "virtual" && (
          <DropdownMenuItem onSelect={onPlan}>
            <Repeat className="mr-2 h-4 w-4" /> Change plan
          </DropdownMenuItem>
        )}
        {r.client_id && r.account_class !== "virtual" && (
          <DropdownMenuItem disabled={archive.isPending} onSelect={() => archive.mutate(!archived)}>
            {archived ? <ArchiveRestore className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}
            {archived ? "Restore" : "Archive"}
          </DropdownMenuItem>
        )}
        {r.user_id && r.account_class !== "virtual" && r.account_class !== "sandbox" && (
          <>
            <DropdownMenuSeparator />
            {r.account_class === "real" ? (
              <>
                <DropdownMenuItem onSelect={() => mark.mutate("test")}>
                  <FlaskConical className="mr-2 h-4 w-4" /> Mark as a test account
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => mark.mutate("demo")}>
                  <FlaskConical className="mr-2 h-4 w-4" /> Mark as a demo account
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onSelect={() => mark.mutate("real")}>
                <UserCheck className="mr-2 h-4 w-4" /> Mark as a real account
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** What's on file for an account, what's off, and the fixes an admin can make. */
function AccountDetails({ r, isAdmin, onClose }: { r: AccountRow; isAdmin: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const makeFn = useServerFn(makeFreeMemberFn);
  const make = useMutation({
    mutationFn: () => makeFn({ data: { userId: r.user_id! } }),
    onSuccess: () => {
      toast.success(`${r.name} is now a free member`);
      void qc.invalidateQueries({ queryKey: ACCOUNT_DIRECTORY_KEY });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't make them a member"),
  });
  const facts: Array<[string, string | null]> = [
    ["Plan", planWords(r)],
    ["Account", r.account_class === "real" ? "Real" : r.account_class[0].toUpperCase() + r.account_class.slice(1)],
    ["Email", r.email],
    ["Phone", r.phone],
    ["Joined", r.created_at ? new Date(r.created_at).toLocaleDateString() : null],
    ["Last signed in", r.last_sign_in_at ? new Date(r.last_sign_in_at).toLocaleString() : "Never"],
    ["Subscription", r.subscription_status],
    ["Login", r.user_id ? (r.confirmed ? "Email confirmed" : "Email not confirmed") : "No login yet"],
  ];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {r.name} <NameMarks person={{ badge: r.badge, virtual: r.account_class === "virtual" }} />
          </DialogTitle>
          <DialogDescription>{r.kind === "pending" ? "A login with no athlete record." : "Account details"}</DialogDescription>
        </DialogHeader>
        <dl className="divide-y rounded-lg border text-sm">
          {facts
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 px-3 py-2">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="min-w-0 truncate text-right">{v}</dd>
              </div>
            ))}
        </dl>
        {r.issues.length > 0 && (
          <div className="space-y-2" data-member-issues>
            {r.issues.map((i) => (
              <div key={i} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                <div className="font-medium">{ISSUE_WORDS[i]?.title ?? i}</div>
                <p className="text-xs text-muted-foreground">{ISSUE_WORDS[i]?.body}</p>
              </div>
            ))}
          </div>
        )}
        {isAdmin && r.issues.includes("no_record") && r.account_class === "real" && (
          <Button className="h-11 w-full" disabled={make.isPending} onClick={() => make.mutate()}>
            {make.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UserPlus className="mr-1.5 h-4 w-4" />}
            Make them a free member
          </Button>
        )}
      </DialogContent>
    </Dialog>
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
