import { ReactNode, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Bell, Search, Upload, Plus, FileText, ListChecks, Megaphone, Link as LinkIcon,
  Star, Calendar, StickyNote, FileEdit,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover";
import { searchMediaWorkspace, KIND_LABEL, type SearchHit } from "@/lib/media-global-search";

/**
 * Shared Media Manager page header (Phase 1 foundation).
 *
 * Every Media Manager page should render this once at the top so search,
 * notifications, upload, and the "+ Create" menu are reachable from any
 * route. Detailed feature wiring lives in later phases — for now the
 * Create menu emits navigation to existing routes where they exist and
 * surfaces deep-links to the new routes for everything else.
 */
export function MediaHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (q.length < 2) { setHits([]); setBusy(false); return; }
    setBusy(true);
    timer.current = setTimeout(async () => {
      try { setHits(await searchMediaWorkspace(q)); }
      finally { setBusy(false); }
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query]);

  const grouped = hits.reduce<Record<string, SearchHit[]>>((acc, h) => {
    (acc[h.kind] ||= []).push(h); return acc;
  }, {});

  return (
    <header className="mb-4 border-b pb-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Popover open={open && query.trim().length >= 2} onOpenChange={setOpen}>
            <PopoverAnchor asChild>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
                  onFocus={() => setOpen(true)}
                  placeholder="Search content, tasks, assets…"
                  className="h-9 w-56 pl-8 md:w-72"
                  aria-label="Search Media Manager"
                />
              </div>
            </PopoverAnchor>
            <PopoverContent
              align="end"
              className="w-[min(28rem,calc(100vw-2rem))] p-0"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <div className="max-h-[60vh] overflow-y-auto p-1">
                {busy && <div className="p-3 text-xs text-muted-foreground">Searching…</div>}
                {!busy && hits.length === 0 && (
                  <div className="p-3 text-xs text-muted-foreground">No matches.</div>
                )}
                {Object.entries(grouped).map(([kind, list]) => (
                  <div key={kind} className="py-1">
                    <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {KIND_LABEL[kind as SearchHit["kind"]]}
                    </div>
                    {list.map((h) => (
                      <button
                        key={`${h.kind}-${h.id}`}
                        onClick={() => {
                          setOpen(false); setQuery("");
                          navigate({ to: h.to as any });
                        }}
                        className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        <div className="truncate font-medium">{h.title}</div>
                        {h.subtitle && (
                          <div className="truncate text-[11px] text-muted-foreground">{h.subtitle}</div>
                        )}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Button asChild variant="outline" size="sm" aria-label="Notifications">
            <Link to="/notifications"><Bell className="mr-1.5 h-4 w-4" />Notifications</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/media/assets"><Upload className="mr-1.5 h-4 w-4" />Upload Files</Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm"><Plus className="mr-1.5 h-4 w-4" />Create</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Create new</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => navigate({ to: "/media/content", search: { tab: "library" } as any })}>
                <FileText className="mr-2 h-4 w-4" />New Content
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/media/work" })}>
                <ListChecks className="mr-2 h-4 w-4" />New Task
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/media/drafts" })}>
                <FileEdit className="mr-2 h-4 w-4" />New Draft
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/media/campaigns" })}>
                <Megaphone className="mr-2 h-4 w-4" />New Campaign
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate({ to: "/media/assets" })}>
                <Upload className="mr-2 h-4 w-4" />Upload Files
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/media/pages" })}>
                <LinkIcon className="mr-2 h-4 w-4" />Add Shared Link
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/media/testimonials" })}>
                <Star className="mr-2 h-4 w-4" />Add Testimonial
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/media/calendar" })}>
                <Calendar className="mr-2 h-4 w-4" />Add Event
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/media/work" })}>
                <StickyNote className="mr-2 h-4 w-4" />Quick Note
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {actions}
        </div>
      </div>
    </header>
  );
}