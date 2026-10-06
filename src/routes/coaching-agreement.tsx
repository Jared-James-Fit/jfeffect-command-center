import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, FileSignature } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgreementReader } from "@/components/coaching-agreement/agreement-reader";
import { AGREEMENT_CONTENT } from "@/lib/coaching-agreement/content";
import { formatSignedDate } from "@/components/coaching-agreement/agreement-copy";
import { useAuth } from "@/lib/auth";

/**
 * Public, read-only copy of the current Coaching Agreement. This is the page linked
 * from checkout ("by paying you agree to the Coaching Agreement") so a buyer can read
 * it before they have an account. Signing happens inside the app.
 */
export const Route = createFileRoute("/coaching-agreement")({
  head: () => ({
    meta: [
      { title: "Coaching Agreement — JF Effect" },
      {
        name: "description",
        content:
          "The JF Effect Coaching Agreement: terms for coaching, personal training, programs and digital products.",
      },
      { name: "robots", content: "noindex,follow" },
    ],
  }),
  component: PublicCoachingAgreement,
});

function PublicCoachingAgreement() {
  const { user } = useAuth();
  const c = AGREEMENT_CONTENT;
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-2xl px-4 pb-16 pt-6 sm:pt-10">
        <Link
          to="/"
          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> JF Effect
        </Link>

        <header className="mt-2 space-y-2">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <FileSignature className="h-6 w-6" />
          </div>
          <p className="text-xs font-bold uppercase tracking-wider text-primary">
            Version {c.version} · Effective {formatSignedDate(`${c.effectiveDate}T12:00:00Z`)}
          </p>
          <h1 className="text-3xl font-black leading-tight tracking-tight">{c.title}</h1>
          <p className="text-[15px] text-muted-foreground">{c.subtitle}</p>
        </header>

        <div className="mt-5 rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          This is a read-only copy. Clients sign it inside the app, and it also applies each time
          you buy a service or product from the Coach.
          <div className="mt-3">
            <Button asChild className="h-11">
              <Link to={user ? "/portal/agreements" : "/auth"}>
                {user ? "Open my agreement" : "Sign in to the app"}
              </Link>
            </Button>
          </div>
        </div>

        <AgreementReader content={c} className="mt-6" />

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Questions? Email{" "}
          <a className="underline" href={`mailto:${c.coach.email}`}>
            {c.coach.email}
          </a>
          .
        </p>
      </div>
    </main>
  );
}
