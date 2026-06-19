import { createFileRoute, redirect } from "@tanstack/react-router";

// Google Play requires a publicly accessible account deletion URL.
// The canonical page is /account-deletion; this alias ensures
// https://jfeffect.com/delete-account also works as required by Play Console.
export const Route = createFileRoute("/delete-account")({
  beforeLoad: () => {
    throw redirect({ to: "/account-deletion", replace: true });
  },
});
