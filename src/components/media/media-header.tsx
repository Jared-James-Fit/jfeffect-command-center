import { ReactNode, useState } from "react";
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

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    // Phase 1: deep-link to the Content Library with the query in URL state.
    navigate({ to: "/media/content", search: { tab: "library" } as any });
  }

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
          <form onSubmit={onSearchSubmit} className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Media Manager…"
              className="h-9 w-56 pl-8"
              aria-label="Search Media Manager"
            />
          </form>
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