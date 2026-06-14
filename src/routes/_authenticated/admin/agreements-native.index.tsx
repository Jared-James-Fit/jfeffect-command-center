import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listNativePackages } from "@/lib/native-agreements.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/agreements-native/")({
  component: NativeAgreementsIndex,
});

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (["voided", "declined", "expired", "delivery_failed", "pdf_failed", "drive_sync_failed", "unsupported_jurisdiction"].includes(status)) return "destructive";
  if (["draft", "legal_review_required", "ready"].includes(status)) return "outline";
  return "secondary";
}

function NativeAgreementsIndex() {
  const fetchList = useServerFn(listNativePackages);
  const { data: packages = [], isLoading } = useQuery({
    queryKey: ["native-packages"],
    queryFn: () => fetchList({ data: {} }),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Native Agreements" subtitle="Structured agreements with versioned snapshots and immutable signatures." />
      <Card className="p-4">
        {isLoading ? <div className="text-sm text-muted-foreground">Loading…</div> : (
          <div className="space-y-2">
            {packages.length === 0 && <div className="text-sm text-muted-foreground">No agreement packages yet. Create one from a client profile.</div>}
            {packages.map((p: any) => (
              <Link key={p.id} to="/admin/agreements-native/$packageId" params={{ packageId: p.id }} className="block">
                <div className="flex items-center justify-between border rounded-md p-3 hover:bg-muted/40">
                  <div>
                    <div className="font-medium">{p.custom_title ?? "Untitled"}</div>
                    <div className="text-xs text-muted-foreground">{p.clients?.first_name} {p.clients?.last_name} · {p.clients?.email}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-sm text-right">
                      {p.contract_value_minor != null && (
                        <div className="font-medium">{new Intl.NumberFormat("en-CA", { style: "currency", currency: p.currency ?? "CAD" }).format(p.contract_value_minor / 100)}</div>
                      )}
                      <div className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleDateString()}</div>
                    </div>
                    <Badge variant={statusVariant(p.status)}>{p.status.replace(/_/g, " ")}</Badge>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
      <div className="text-xs text-muted-foreground">To create an agreement, open a client → Agreements tab.</div>
    </div>
  );
}