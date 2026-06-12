import { createFileRoute, Link } from "@tanstack/react-router";
import { SalesPageShell, Section } from "@/components/sales/sales-page-shell";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/coaching/apply")({
  component: CoachingApply,
  head: () => ({
    meta: [
      { title: "Apply for JF Effect Coaching" },
      { name: "description", content: "Tell us about your goals and we'll get you set up." },
      { property: "og:title", content: "Apply for JF Effect Coaching" },
      { property: "og:description", content: "Tell us about your goals and we'll get you set up." },
    ],
  }),
});

function CoachingApply() {
  return (
    <SalesPageShell>
      <Section className="!py-8">
        <Link to="/coaching" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" />Back to coaching page
        </Link>
        <div className="mx-auto w-full max-w-4xl overflow-hidden rounded-xl border bg-background shadow-sm">
          <iframe
            src="https://jaredjamesfit.fillout.com/apply"
            title="Apply for JF Effect Coaching"
            className="block h-[85vh] min-h-[720px] w-full border-0"
            allow="clipboard-write; camera; microphone; geolocation"
          />
        </div>
      </Section>
    </SalesPageShell>
  );
}