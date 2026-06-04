import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { PhoneCall, CreditCard, Package, UserPlus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/sales")({
  component: SalesHub,
});

const TILES = [
  { to: "/admin/leads", label: "Leads", desc: "Inbound prospects & pipeline.", icon: UserPlus },
  { to: "/admin/sales-calls", label: "Sales Calls", desc: "Discovery + close calls.", icon: PhoneCall },
  { to: "/admin/payments", label: "Payments", desc: "Invoices, status, overdue.", icon: CreditCard },
  { to: "/admin/offers", label: "Offers / Products", desc: "Packages and pricing.", icon: Package },
] as const;

function SalesHub() {
  return (
    <>
      <PageHeader title="Sales" subtitle="Pipeline, calls, payments, and offers." />
      <div className="grid gap-4 p-6 sm:grid-cols-2 md:p-8">
        {TILES.map((t) => (
          <Link key={t.to} to={t.to}>
            <Card className="group border-border bg-card p-6 transition hover:border-primary hover:bg-secondary/40">
              <div className="flex items-start gap-4">
                <div className="grid h-10 w-10 place-items-center rounded-md bg-gradient-primary text-primary-foreground">
                  <t.icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-base font-bold">{t.label}</div>
                  <div className="text-sm text-muted-foreground">{t.desc}</div>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}