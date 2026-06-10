import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import type { ReactNode } from "react";

export function MembershipLeaf({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="space-y-5">
      <PageHeader title={title} subtitle={subtitle} backTo="/admin/membership" backLabel="Membership Dashboard" />
      {children}
    </div>
  );
}

export function ComingSoonCard({ note }: { note?: string }) {
  return (
    <Card className="border-dashed border-border bg-card p-8 text-center">
      <div className="text-sm font-bold text-muted-foreground">Coming soon</div>
      {note && <div className="mt-2 text-xs text-muted-foreground">{note}</div>}
    </Card>
  );
}