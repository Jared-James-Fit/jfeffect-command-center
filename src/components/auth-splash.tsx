import { Loader2 } from "lucide-react";
import { AuthShell, AuthLogo } from "@/components/auth/auth-shell";

/** Shown while the session restores / after sign-in — same calm look as the sign-in screen. */
export function AuthSplash({ message = "Opening your dashboard…" }: { message?: string }) {
  return (
    <AuthShell>
      <div className="flex flex-col items-center gap-5">
        <AuthLogo />
        <div className="flex items-center gap-2 text-[14px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span>{message}</span>
        </div>
      </div>
    </AuthShell>
  );
}
