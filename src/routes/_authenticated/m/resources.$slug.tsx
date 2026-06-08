import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { memberGetResource } from "@/lib/member-resources.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UpgradeCTA } from "@/components/upgrade-cta";
import { ArrowLeft, ExternalLink, Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/m/resources/$slug")({ component: ResourceDetail });

function ResourceDetail() {
  const { slug } = Route.useParams();
  const fetchFn = useServerFn(memberGetResource);
  const { data, isLoading } = useQuery({
    queryKey: ["m-resource", slug],
    queryFn: () => fetchFn({ data: { slug } }),
  });
  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!data?.resource) return <div className="p-6 text-sm text-muted-foreground">Not found.</div>;
  const r = data.resource;
  return (
    <div className="space-y-5">
      <PageHeader
        title={r.title}
        subtitle={r.description ?? undefined}
        actions={<Link to="/m/resources"><Button variant="outline" size="sm"><ArrowLeft className="mr-1 h-3.5 w-3.5" />Back</Button></Link>}
      />
      {!data.hasAccess && (
        <UpgradeCTA title="This resource is locked" subtitle={`Requires the "${r.required_access_level}" tier.`} />
      )}
      {data.hasAccess && (
        <>
          {r.format === "video" && r.url && (
            <Card className="overflow-hidden">
              <div className="aspect-video">
                <iframe src={r.url} className="h-full w-full" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
              </div>
            </Card>
          )}
          {(r.format === "pdf" || r.format === "image") && data.signedUrl && (
            <Card className="p-6">
              <Button asChild><a href={data.signedUrl} target="_blank" rel="noopener noreferrer"><Download className="mr-2 h-4 w-4" />Open / Download</a></Button>
            </Card>
          )}
          {r.format === "link" && r.url && (
            <Card className="p-6">
              <Button asChild><a href={r.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Open external link</a></Button>
            </Card>
          )}
          {r.format === "embed" && r.url && (
            <Card className="overflow-hidden"><iframe src={r.url} className="h-[70vh] w-full" /></Card>
          )}
          {r.body_md && (
            <Card className="prose prose-sm max-w-none whitespace-pre-wrap p-6 dark:prose-invert">{r.body_md}</Card>
          )}
        </>
      )}
    </div>
  );
}