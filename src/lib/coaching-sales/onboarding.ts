/**
 * What a new coaching client is told happens next, the same words on the
 * welcome email and the site's return page. Pure and tested. The checklist
 * itself is the app's (SetupChecklistBanner: the Coaching Agreement first,
 * then the intake, goals and calendar), so these lines only point at it.
 */
export function onboardingSteps(o: { hasAccount: boolean; setupSent: boolean }): string[] {
  const steps: string[] = [];
  if (!o.hasAccount) {
    steps.push(
      o.setupSent
        ? "1. Open the setup email I just sent you and set your password."
        : "1. Watch your inbox for the email to set up your account (check spam if it's not there in a few minutes).",
    );
  } else {
    steps.push("1. Open the JF Effect app and sign in.");
  }
  steps.push("2. Your Home screen has a short setup checklist: the Coaching Agreement first, then a few questions about your training.");
  steps.push("3. I'll build your program from your answers and message you in the app.");
  return steps;
}

/** The site's return page after Stripe: what it may say, never what it may grant. */
export function returnCopy(state: "paid" | "cancelled" | "none"): { title: string; body: string } {
  if (state === "paid") {
    return {
      title: "Thanks. Your payment is being confirmed.",
      body: "As soon as Stripe confirms it, I'll email you the link to set up your account. That usually takes a minute.",
    };
  }
  if (state === "cancelled") {
    return { title: "No charge was made.", body: "You can start again whenever you're ready, or book a call first." };
  }
  return { title: "Coaching", body: "Pick a package to get started." };
}
