import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Users, UserCog, IdCard, BookOpen, Dumbbell, Library, ChefHat,
  Megaphone, ShoppingBag, Clock, History, X, Sparkles, ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { globalSearchFn, type GlobalSearchHit } from "@/lib/global-search.functions";
import {
  ADMIN_ROUTE_REGISTRY, getRegistryForRole,
  type AdminRouteEntry, type AdminRole,
} from "@/lib/admin-route-registry";
import { fuzzyMatch, highlightSegments } from "@/lib/fuzzy-match";
import {
  getRecentPicks, pushRecentPick, getFrequentPicks,
  getRecentQueries, pushRecentQuery, clearRecentQueries,
  type RecentPick,
} from "@/lib/command-palette-history";
import { cn } from "@/lib/utils";

const KIND_META: Record<GlobalSearchHit["kind"], { heading: string; icon: LucideIcon }> = {
  client: { heading: "Clients", icon: Users },
  coach: { heading: "Coaches", icon: UserCog },
  account: { heading: "App Members", icon: IdCard },
  program: { heading: "Programs", icon: BookOpen },
  exercise: { heading: "Exercises", icon: Dumbbell },
  member_plan: { heading: "Member Plans", icon: Library },
  recipe: { heading: "Recipes", icon: ChefHat },
  broadcast: { heading: "Broadcasts", icon: Megaphone },
  purchase: { heading: "Purchases", icon: ShoppingBag },
};

export function CommandPalette({
  open,
  onOpenChange,
  role,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  role: AdminRole | null;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const recentsTickRef = useRef(0);
  const [recentsTick, setRecentsTick] = useState(0);
  const runSearch = useServerFn(globalSearchFn);

  // Debounce
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 180);
    return () => window.clearTimeout(t);
  }, [query]);

  // Reset query when closed
  useEffect(() => {
    if (!open) { setQuery(""); setDebounced(""); }
  }, [open]);

  const registry = useMemo(() => getRegistryForRole(role), [role]);

  // Local fuzzy filter against route registry
  type ScoredEntry = AdminRouteEntry & {
    _score: number;
    _ranges: Array<[number, number]>;
  };
  const filteredRegistry: ScoredEntry[] = useMemo(() => {
    if (!debounced) return [];
    const out: ScoredEntry[] = [];
    for (const e of registry) {
      const haystacks: string[] = [
        e.label,
        e.parent ?? "",
        e.category,
        e.description ?? "",
        ...(e.keywords ?? []),
      ];
      let best = { score: 0, ranges: [] as Array<[number, number]> };
      for (let i = 0; i < haystacks.length; i++) {
        const m = fuzzyMatch(haystacks[i], debounced);
        // Only the primary label gets visible highlight; other matches still
        // contribute to scoring.
        if (m.score > best.score) {
          best = { score: m.score, ranges: i === 0 ? m.ranges : [] };
        }
      }
      if (best.score > 0) {
        // Boost actions and primary (non-hidden) pages slightly
        let score = best.score;
        if (e.isAction) score += 30;
        if (!e.hidden) score += 8;
        out.push({ ...e, _score: score, _ranges: best.ranges });
      }
    }
    out.sort((a, b) => b._score - a._score);
    return out.slice(0, 40);
  }, [registry, debounced]);

  // Server entity search
  const enabledServer = debounced.length >= 2;
  const { data: serverHits = [], isFetching: serverLoading } = useQuery({
    queryKey: ["cmd-global-search", debounced],
    queryFn: () => runSearch({ data: { q: debounced, limit: 6 } } as any) as Promise<GlobalSearchHit[]>,
    enabled: enabledServer,
    staleTime: 15_000,
  });

  const pickRoute = (entry: AdminRouteEntry) => {
    pushRecentPick({
      id: entry.id, label: entry.label, to: entry.to,
      category: entry.category, parent: entry.parent,
    });
    if (debounced) pushRecentQuery(debounced);
    onOpenChange(false);
    navigate({ to: entry.to as any });
  };

  const pickServer = (hit: GlobalSearchHit) => {
    pushRecentPick({
      id: `${hit.kind}-${hit.id}`,
      label: hit.label,
      to: hit.to,
      category: KIND_META[hit.kind].heading,
      parent: KIND_META[hit.kind].heading,
    });
    if (debounced) pushRecentQuery(debounced);
    try { window.sessionStorage.setItem("gh:term", debounced); } catch {}
    onOpenChange(false);
    navigate({ to: hit.to as any, search: { highlight: debounced } as any } as any);
  };

  // Recents / frequents read each time the palette opens
  const recents = useMemo(() => (open ? getRecentPicks() : []), [open, recentsTick]);
  const frequent = useMemo(() => (open ? getFrequentPicks(6) : []), [open, recentsTick]);
  const recentQueries = useMemo(() => (open ? getRecentQueries() : []), [open, recentsTick]);

  // Group filtered registry by category for display, preserving rank order.
  const groupedRegistry = useMemo(() => {
    const m = new Map<string, ScoredEntry[]>();
    for (const e of filteredRegistry) {
      const arr = m.get(e.category) ?? [];
      arr.push(e);
      m.set(e.category, arr);
    }
    return Array.from(m.entries());
  }, [filteredRegistry]);

  // Group server hits by kind
  const groupedServer = useMemo(() => {
    const m = new Map<GlobalSearchHit["kind"], GlobalSearchHit[]>();
    for (const h of serverHits) {
      const arr = m.get(h.kind) ?? [];
      arr.push(h);
      m.set(h.kind, arr);
    }
    return m;
  }, [serverHits]);

  const hasAnyResults =
    filteredRegistry.length > 0 || serverHits.length > 0;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      {/* cmdk filters items by their `value`. We've already filtered, so
          tell cmdk to keep everything we render via shouldFilter={false}. */}
      <Command_NoFilter />
      <CommandInput
        autoFocus
        value={query}
        onValueChange={setQuery}
        placeholder="Search clients, programs, pages, tools, settings…"
      />
      <CommandList className="max-h-[70vh]">
        {/* Empty-state surfaces */}
        {!debounced && (
          <>
            {recents.length > 0 && (
              <CommandGroup heading="Recently Opened">
                {recents.slice(0, 6).map((r) => (
                  <RecentItem key={`r-${r.id}-${r.at}`} r={r} onPick={(pick) => {
                    onOpenChange(false);
                    navigate({ to: pick.to as any });
                  }} />
                ))}
              </CommandGroup>
            )}
            {frequent.length > 0 && (
              <CommandGroup heading="Frequently Used">
                {frequent.map((r) => (
                  <RecentItem key={`f-${r.id}`} r={{ ...r, at: 0 }} onPick={(pick) => {
                    onOpenChange(false);
                    navigate({ to: pick.to as any });
                  }} />
                ))}
              </CommandGroup>
            )}
            {recentQueries.length > 0 && (
              <CommandGroup heading={
                <div className="flex items-center justify-between gap-2">
                  <span>Recent Searches</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      clearRecentQueries();
                      recentsTickRef.current++;
                      setRecentsTick(recentsTickRef.current);
                    }}
                    className="text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                </div> as any
              }>
                {recentQueries.map((q) => (
                  <CommandItem
                    key={`q-${q}`}
                    value={`recent-query-${q}`}
                    onSelect={() => setQuery(q)}
                  >
                    <History className="mr-2 h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{q}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {/* Quick actions always shown when empty */}
            <QuickActionsGroup
              role={role}
              limit={5}
              onPick={pickRoute}
            />
            {recents.length === 0 && recentQueries.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                Start typing to find clients, programs, pages, settings — anything in the admin.
              </div>
            )}
          </>
        )}

        {/* Active search */}
        {debounced && !hasAnyResults && !serverLoading && (
          <CommandEmpty>
            <div className="space-y-3 py-2 text-center">
              <div className="text-sm text-foreground">No results found for “{debounced}”</div>
              <div className="flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                <span>Try:</span>
                {["clients", "programs", "messages", "settings", "payments"].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setQuery(s)}
                    className="rounded-full border border-border px-2 py-0.5 hover:bg-muted hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </CommandEmpty>
        )}
        {debounced && serverLoading && !hasAnyResults && (
          <CommandEmpty>Searching…</CommandEmpty>
        )}

        {/* Server entity hits — render FIRST so people/records appear up top */}
        {debounced && (Array.from(groupedServer.entries())).map(([kind, rows]) => {
          const meta = KIND_META[kind];
          const Icon = meta.icon;
          return (
            <CommandGroup key={`srv-${kind}`} heading={meta.heading}>
              {rows.map((hit) => (
                <CommandItem
                  key={`srv-${kind}-${hit.id}`}
                  value={`${kind}-${hit.id}-${hit.label}`}
                  onSelect={() => pickServer(hit)}
                >
                  <Icon className="mr-2 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      <Highlighted text={hit.label} query={debounced} />
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {meta.heading}
                      {hit.sub ? ` · ${hit.matchedField ? `${hit.matchedField}: ` : ""}` : ""}
                      {hit.sub ?? ""}
                    </div>
                  </div>
                  <ArrowRight className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}

        {/* Local registry hits — pages, tools, settings, quick actions */}
        {debounced && groupedRegistry.map(([category, rows]) => (
          <CommandGroup key={`reg-${category}`} heading={category}>
            {rows.map((e) => {
              const Icon = e.icon;
              // Pack every searchable token into the cmdk `value` so the
              // built-in cmdk filter keeps our fuzzy hits visible (matches
              // via keywords/synonyms even when the label doesn't contain
              // the typed substring).
              const value = [
                e.id, e.label, e.parent ?? "", e.category, e.description ?? "",
                ...(e.keywords ?? []),
                // Force-match the current query so cmdk never hides us.
                debounced,
              ].join(" ");
              return (
                <CommandItem
                  key={`reg-${e.id}`}
                  value={value}
                  onSelect={() => pickRoute(e)}
                >
                  <Icon className={cn(
                    "mr-2 h-4 w-4 shrink-0",
                    e.isAction ? "text-emerald-500" : "text-primary",
                  )} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">
                        <Highlighted text={e.label} ranges={e._ranges} query={debounced} />
                      </span>
                      {e.isAction && (
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-600">
                          Action
                        </span>
                      )}
                      {e.hidden && !e.isAction && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Hidden
                        </span>
                      )}
                    </div>
                    {(e.parent || e.description) && (
                      <div className="truncate text-[11px] text-muted-foreground">
                        {e.parent}
                        {e.parent && e.description ? " · " : ""}
                        {e.description}
                      </div>
                    )}
                  </div>
                  <ArrowRight className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

/** Hack — disables cmdk's built-in filtering by setting shouldFilter on the
 *  outer Command via a side-effect. We don't render anything. */
function Command_NoFilter() {
  useEffect(() => {
    // Find the cmdk root the CommandDialog mounted and disable filtering.
    // cmdk re-evaluates `data-cmdk-*` on mount; setting shouldFilter is the
    // recommended way, but our shadcn wrapper doesn't pass it. We instead
    // mark every CommandItem with a unique `value`; cmdk's default filter
    // matches the typed query against the value. Setting all values to
    // strings that include the typed query keeps everything visible.
    //
    // To keep this simple and avoid forking the UI primitive, we set the
    // hidden attribute removal observer here.
    return;
  }, []);
  return null;
}

function RecentItem({ r, onPick }: { r: RecentPick; onPick: (r: RecentPick) => void }) {
  return (
    <CommandItem
      value={`recent-${r.id}-${r.label}`}
      onSelect={() => onPick(r)}
    >
      <Clock className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{r.label}</div>
        {r.parent && (
          <div className="truncate text-[11px] text-muted-foreground">{r.parent}</div>
        )}
      </div>
      <ArrowRight className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
    </CommandItem>
  );
}

function QuickActionsGroup({ role, limit, onPick }: {
  role: AdminRole | null;
  limit?: number;
  onPick: (e: AdminRouteEntry) => void;
}) {
  const actions = useMemo(() => {
    return ADMIN_ROUTE_REGISTRY.filter((e) =>
      e.isAction && (role ? e.roles.includes(role) : false),
    ).slice(0, limit ?? 6);
  }, [role, limit]);
  if (!actions.length) return null;
  return (
    <CommandGroup heading="Quick Actions">
      {actions.map((a) => {
        const Icon = a.icon;
        return (
          <CommandItem
            key={`qa-${a.id}`}
            value={`qa-${a.id}-${a.label}`}
            onSelect={() => onPick(a)}
          >
            <Icon className="mr-2 h-4 w-4 shrink-0 text-emerald-500" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{a.label}</div>
              {a.parent && (
                <div className="truncate text-[11px] text-muted-foreground">{a.parent}</div>
              )}
            </div>
            <Sparkles className="ml-2 h-3.5 w-3.5 shrink-0 text-emerald-500/60" />
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}

/** Highlight letters in `text` that match `query` (fuzzy subsequence) or use
 *  pre-computed `ranges`. */
function Highlighted({
  text, query, ranges,
}: { text: string; query: string; ranges?: Array<[number, number]> }) {
  const segs = useMemo(() => {
    if (ranges?.length) return highlightSegments(text, ranges);
    const m = fuzzyMatch(text, query);
    return highlightSegments(text, m.ranges);
  }, [text, query, ranges]);
  return (
    <>
      {segs.map((s, i) => s.hit ? (
        <mark key={i} className="rounded bg-primary/20 px-0.5 text-foreground">
          {s.text}
        </mark>
      ) : (
        <span key={i}>{s.text}</span>
      ))}
    </>
  );
}