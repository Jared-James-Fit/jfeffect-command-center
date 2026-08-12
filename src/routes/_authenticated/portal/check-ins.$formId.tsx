import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { ClientFormRenderer } from "@/components/forms/client-form-renderer";

export const Route = createFileRoute("/_authenticated/portal/check-ins/$formId")({
  component: FormRoutePage,
  errorComponent: FormRouteError,
  notFoundComponent: FormRouteNotFound,
});

function FormRoutePage() {
  const { formId } = Route.useParams();
  return <ClientFormRenderer formId={formId} />;
}

function FormRouteError({ error, reset }: { error: Error; reset: () => void }) {
  // eslint-disable-next-line no-console
  console.error("[check-ins/$formId] route error", error);
  return (
    <>
      <PageHeader title="Check-In unavailable" backTo="/portal/check-ins" backLabel="Back to Check-Ins" />
      <div className="mx-auto max-w-2xl p-4 md:p-8">
        <Card className="border-border bg-card p-6 text-sm">
          <div className="font-semibold">This form couldn't load.</div>
          <div className="mt-1 text-muted-foreground">
            {error?.message || "Please try again in a moment."}
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => reset()} className="bg-gradient-primary font-bold">Try again</Button>
            <Button variant="outline" asChild>
              <Link to="/portal/check-ins"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Check-Ins</Link>
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}

function FormRouteNotFound() {
  return (
    <>
      <PageHeader title="Check-In unavailable" backTo="/portal/check-ins" backLabel="Back to Check-Ins" />
      <div className="mx-auto max-w-2xl p-4 md:p-8">
        <Card className="border-border bg-card p-6 text-sm text-muted-foreground">
          This form isn't available. It may have been removed or unassigned.
          <div className="mt-4">
            <Button variant="outline" asChild>
              <Link to="/portal/check-ins"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Check-Ins</Link>
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
