import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CreditCard } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/offers")({
  component: OffersRedirect,
});

function OffersRedirect() {
  // Auto-redirect after mount so deep links land in the new home.
  if (typeof window !== "undefined") {
    return <Navigate to="/admin/payment-links" />;
  }
  return (
    <>
      <PageHeader title="Moved" subtitle="Product and payment link creation now lives in Stripe Payment Links." />
      <div className="p-6 md:p-8">
        <Card className="border-border bg-card p-10 text-center space-y-4">
          <p className="text-sm text-muted-foreground">
            Product and payment link creation now lives in Stripe Payment Links.
          </p>
          <Link to="/admin/payment-links">
            <Button className="bg-gradient-primary">
              <CreditCard className="mr-2 h-4 w-4" /> Go to Stripe Payment Links
            </Button>
          </Link>
        </Card>
      </div>
    </>
  );
}