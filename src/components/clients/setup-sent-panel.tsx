import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, CheckCircle2, Copy, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { setupMessageText, smsComposeHref } from "@/lib/setup-message";

export type SetupOutcome = { ok: true } | { ok: false; error: string };

/**
 * What a coach sees right after adding a client or member: whether the setup email and
 * text went out, and the setup message ready to copy or send from their own phone.
 * Shared by Add Client and New Member so both onboard the same way.
 */
export function SetupSentPanel({
  firstName,
  email,
  phone,
  emailed,
  texted,
  url,
  linkError,
  continueStep,
}: {
  firstName: string;
  email: string;
  phone: string | null;
  emailed: SetupOutcome;
  texted: SetupOutcome;
  /** The link to share; the texted one where there is one, so sharing never cancels it. */
  url: string | null;
  linkError?: string;
  /** Client links show a Continue screen first; member links open on the password form. */
  continueStep?: boolean;
}) {
  const message = url ? setupMessageText({ firstName, url, continueStep }) : "";

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Setup message copied");
    } catch {
      toast.error("Couldn't copy. Select the message and copy it.");
    }
  };

  return (
    <div className="space-y-4">
      <ul className="space-y-2 text-sm" aria-label="Setup link delivery">
        <SentLine label={`Email to ${email}`} outcome={emailed} />
        <SentLine label={phone ? `Text to ${phone}` : "Text"} outcome={texted} />
      </ul>
      {url ? (
        <div className="space-y-2">
          <Label htmlFor="setup-message">Setup message</Label>
          <Textarea id="setup-message" readOnly value={message} rows={6} className="text-sm" onFocus={(e) => e.currentTarget.select()} />
          <p className="text-xs text-muted-foreground">
            Emails can land in spam. Sending this from your own phone is the surest way in.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button className="min-h-[44px]" onClick={copyMessage}>
              <Copy className="mr-2 h-4 w-4" /> Copy message
            </Button>
            {phone && (
              <Button asChild variant="outline" className="min-h-[44px]">
                <a href={smsComposeHref(phone, message)}>
                  <MessageSquare className="mr-2 h-4 w-4" /> Text from my phone
                </a>
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-destructive">
          Couldn't create a setup link{linkError ? `: ${linkError}` : ""}. Open their profile to send one.
        </p>
      )}
    </div>
  );
}

function SentLine({ label, outcome }: { label: string; outcome: SetupOutcome }) {
  return (
    <li className="flex items-start gap-2">
      {outcome.ok
        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />}
      <span className="min-w-0">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{outcome.ok ? " · sent" : ` · not sent: ${outcome.error}`}</span>
      </span>
    </li>
  );
}
