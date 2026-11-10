import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail, Trash2, ShieldAlert } from "lucide-react";
import { shareMeta } from "@/lib/share-meta";

export const Route = createFileRoute("/account-deletion")({
  head: () => ({
    meta: [
      { title: "Delete your JF Effect account" },
      {
        name: "description",
        content:
          "Delete your JF Effect account from inside the app or by email. It waits 30 days in Recently deleted so you can restore it, then it's deleted for good.",
      },
      ...shareMeta({ title: "Delete your JF Effect account", description: "How to delete your JF Effect account and data.", path: "/account-deletion" }),
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
            You can delete your account and personal data at any time. To protect you from
            deleting it by mistake, it waits in Recently deleted for 30 days first: sign back in
            before then and tap Restore, and everything comes back. After 30 days it's deleted
            for good and can't be recovered.
          </p>
        </header>

        <Card className="space-y-4 p-6">
          <h2 className="text-lg font-semibold text-foreground">
            Option 1 — Delete from inside the app
          </h2>
          <ol className="ml-4 list-decimal space-y-2 text-sm text-muted-foreground">
            <li>Sign in to your account.</li>
            <li>
              Open <span className="font-medium text-foreground">More → Account Settings</span>.
            </li>
            <li>
              Tap <span className="font-medium text-foreground">Delete account</span>, then{" "}
              <span className="font-medium text-foreground">Delete my account</span>, and confirm.
            </li>
          </ol>
          <p className="text-sm text-muted-foreground">
            You're signed out right away and hidden from the Crew. Changed your mind? Sign back in
            within 30 days and tap Restore my account.
          </p>
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
            with. We'll verify it's you and start the deletion within 7 days; it's then
            deleted for good 30 days later.
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
            <li>Notification preferences and your Crew profile, posts and programs.</li>
          </ul>
          <p className="text-xs text-muted-foreground">
            Chat messages are kept as a record of the conversation for the other people in it, as
            our Privacy Policy explains: if you have any, your account is closed and your login
            removed instead of the chats being deleted.
          </p>
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