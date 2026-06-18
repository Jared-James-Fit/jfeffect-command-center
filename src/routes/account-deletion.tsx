import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail, Trash2, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/account-deletion")({
  head: () => ({
    meta: [
      { title: "Delete your JF Effect account" },
      {
        name: "description",
        content:
          "Request permanent deletion of your JF Effect account and personal data. Submit a request from inside the app or by email.",
      },
      { property: "og:title", content: "Delete your JF Effect account" },
      {
        property: "og:description",
        content: "How to permanently delete your JF Effect account and data.",
      },
    ],
  }),
  component: AccountDeletionPage,
});

function AccountDeletionPage() {
  const supportEmail = "support@jfeffect.com";
  const subject = encodeURIComponent("Account deletion request");
  const body = encodeURIComponent(
    "Hi JF Effect team,\n\nPlease permanently delete my JF Effect account and associated personal data.\n\nAccount email: \nReason (optional): \n\nThank you.",
  );

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5" />
            Account & data
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Delete your JF Effect account
          </h1>
          <p className="text-sm text-muted-foreground">
            You can permanently delete your account and personal data at any time.
            Once a deletion request is processed, your profile, training history,
            check-ins, messages, and uploaded media are removed and cannot be recovered.
          </p>
        </header>

        <Card className="space-y-4 p-6">
          <h2 className="text-lg font-semibold text-foreground">
            Option 1 — Delete from inside the app
          </h2>
          <ol className="ml-4 list-decimal space-y-2 text-sm text-muted-foreground">
            <li>Sign in to your account.</li>
            <li>
              Open <span className="font-medium text-foreground">Settings → Account</span>.
            </li>
            <li>
              Tap <span className="font-medium text-foreground">Delete account</span> and
              confirm.
            </li>
          </ol>
          <div className="pt-2">
            <Button asChild>
              <Link to="/auth">Sign in to continue</Link>
            </Button>
          </div>
        </Card>

        <Card className="space-y-4 p-6">
          <h2 className="text-lg font-semibold text-foreground">
            Option 2 — Email request
          </h2>
          <p className="text-sm text-muted-foreground">
            If you can't access your account, email us from the address you signed up
            with and we'll verify and process the deletion within 7 days.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild variant="default">
              <a href={`mailto:${supportEmail}?subject=${subject}&body=${body}`}>
                <Mail className="mr-2 h-4 w-4" />
                Email {supportEmail}
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={`mailto:${supportEmail}`}>Contact support</a>
            </Button>
          </div>
        </Card>

        <Card className="space-y-3 p-6">
          <div className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-foreground" />
            <h2 className="text-lg font-semibold text-foreground">What gets deleted</h2>
          </div>
          <ul className="ml-4 list-disc space-y-1.5 text-sm text-muted-foreground">
            <li>Your profile, login, and contact information.</li>
            <li>Training programs, completed workouts, and progress logs.</li>
            <li>Check-ins, photos, measurements, and uploaded media.</li>
            <li>Messages with coaches and notification preferences.</li>
          </ul>
          <p className="text-xs text-muted-foreground">
            Billing records and other data we are required to retain for tax,
            accounting, or legal reasons are kept for the minimum period required
            by law, then permanently removed.
          </p>
        </Card>

        <div className="text-center text-xs text-muted-foreground">
          <Link to="/privacy" className="underline">Privacy policy</Link>
          <span className="mx-2">·</span>
          <Link to="/terms" className="underline">Terms</Link>
          <span className="mx-2">·</span>
          <Link to="/" className="underline">Home</Link>
        </div>
      </div>
    </div>
  );
}