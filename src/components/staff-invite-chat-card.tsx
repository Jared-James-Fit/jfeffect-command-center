import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A staff invite sent in Messenger: one tap opens the setup page. The link
 * is the same-origin /staff-setup?token=… path, so it opens in the app.
 */
export function StaffInviteChatCard({
  att, mine,
}: {
  att: { url: string; title?: string; role_label?: string; staff_email?: string; expires_at?: string };
  mine: boolean;
}) {
  const expired = !!att.expires_at && Date.parse(att.expires_at) < Date.now();
  return (
    <div className={cn("w-[260px] max-w-full rounded-2xl border bg-card p-3 text-card-foreground shadow-sm", mine && "border-primary/30")}>
      <div className="flex items-start gap-2.5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <ShieldCheck className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">{att.title ?? "Set up your team account"}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {att.role_label ? `${att.role_label} · ` : ""}separate login
          </div>
          {att.staff_email && <div className="mt-0.5 truncate text-xs text-muted-foreground">{att.staff_email}</div>}
        </div>
      </div>
      {expired ? (
        <div className="mt-3 rounded-lg bg-muted px-3 py-2 text-center text-sm font-semibold text-muted-foreground">Link expired</div>
      ) : (
        <a href={att.url} className="mt-3 block rounded-lg bg-primary px-3 py-2 text-center text-sm font-semibold text-primary-foreground">
          Set up account
        </a>
      )}
    </div>
  );
}
