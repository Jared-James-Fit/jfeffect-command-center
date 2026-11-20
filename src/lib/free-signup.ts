/** A free JF Effect account: the sign-up form's rules (pure, tested). */

export type FreeSignupInput = { firstName: string; email: string; password: string };
export type FreeSignupProblem = { field: keyof FreeSignupInput; message: string };

export const PASSWORD_MIN = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The first thing to fix, in form order, or null when it can go. */
export function checkFreeSignup(f: FreeSignupInput): FreeSignupProblem | null {
  const name = f.firstName.trim();
  if (!name) return { field: "firstName", message: "Enter your first name." };
  if (name.length > 60) return { field: "firstName", message: "That name is too long." };
  const email = f.email.trim();
  if (!email) return { field: "email", message: "Enter your email." };
  if (!EMAIL.test(email)) return { field: "email", message: "That email doesn't look right." };
  if (f.password.length < PASSWORD_MIN) {
    return {
      field: "password",
      message: `Use at least ${PASSWORD_MIN} characters for your password.`,
    };
  }
  if (f.password.length > 72) return { field: "password", message: "Use 72 characters or fewer." };
  return null;
}

/** Where the confirmation email lands: /welcome on this site (scanner-safe, see scanner-safe-auth-link.ts). */
export function freeSignupRedirect(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/welcome`;
}

export type FreeJoinStatus =
  | "member"
  | "pending"
  | "not_approved"
  | "athlete"
  | "staff"
  | "coach_account"
  | "unconfirmed"
  | "signed_out"
  | "no_user"
  | "other_account";

/** What /welcome says for each answer of member_free_join (null = go into the app). */
export function freeJoinMessage(
  status: FreeJoinStatus | string | null | undefined,
): { title: string; body: string; cta?: { to: string; label: string } } | null {
  switch (status) {
    // free membership is by application (membership-apply.ts)
    case "pending":
      return {
        title: "Your application is with Jared",
        body: "You'll get an email with your link as soon as it's approved, usually within a day.",
        cta: { to: "/", label: "Back to JF Effect" },
      };
    case "not_approved":
      return {
        title: "JF Effect is by application",
        body: "Applying is free and takes about a minute. Jared reads every one and sends your invite once you're approved.",
        cta: { to: "/join", label: "Apply free" },
      };
    case "coach_account":
      return {
        title: "Your coach already set you up",
        body: "Your coach already has an account set up for this email. Ask them to send your invite again: it lets you set your password and get straight in.",
      };
    case "unconfirmed":
      return {
        title: "Confirm your email first",
        body: "Open the link we emailed you, then come back.",
      };
    case "signed_out":
    case "no_user":
      return {
        title: "That link didn't sign you in",
        body: "Sign in with the email and password you just made.",
      };
    default:
      return null;
  }
}
