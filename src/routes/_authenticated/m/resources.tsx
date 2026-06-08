import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { memberListResources } from "@/lib/member-resources.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, PlayCircle, Link as LinkIcon, FileImage, Lock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/m/resources")({ component: ResourcesPage });

function iconFor(format: string) {
  if (format === "video") return PlayCircle;
  if (format === "pdf" || format === "article") return FileText;
  if (format === "image") return FileImage;
  return LinkIcon;
}

function ResourcesPage() {
  const fetchFn = useServerFn(memberListResources);
  const { data } = useQuery({ queryKey: ["m-resources"], queryFn: () => fetchFn({ data: { kind: "resource" } }) });
  const items: any[] = data?.items ?? [];
  return (
    <div className="space-y-6">
      <PageHeader title="Resources" subtitle="Guides, PDFs, and videos included in your membership." />
      {items.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">Resource library coming soon.</Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((r) => {
            const Icon = iconFor(r.format);
            return (
              <Link key={r.id} to="/m/resources/$slug" params={{ slug: r.slug }}>
                <Card className="h-full p-5 transition hover:bg-muted/40">
                  <div className="flex items-start justify-between gap-3">
                    <Icon className="h-5 w-5 text-primary" />
                    {r.locked && <Badge variant="outline"><Lock className="mr-1 h-3 w-3" />Locked</Badge>}
                  </div>
                  <div className="mt-3 font-semibold">{r.title}</div>
                  {r.description && <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{r.description}</div>}
                  <div className="mt-3 text-[10px] uppercase tracking-wider text-muted-foreground">{r.format}</div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}