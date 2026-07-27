import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import {
  UserCog, CreditCard, ReceiptText, Bell, Shield, LifeBuoy,
  FileText, Trash2, ChevronRight, Megaphone, Wrench, Camera,
  Download, LogOut,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/m/more")({
  component: MorePage,
});

type Row = {
  to?: string;
  href?: string;
  label: string;
  description?: string;
  icon: any;
  external?: boolean;
  destructive?: boolean;
};

const MANAGE: Row[] = [
  { to: "/m/account", label: "Profile", description: "Name, email, preferences", icon: UserCog },
  { to: "/m/billing", label: "Membership & Billing", description: "Plan, payment method, receipts", icon: CreditCard },
  { to: "/portal/agreements", label: "Agreements", description: "Signed documents and consents", icon: FileText },
  { to: "/m/account", label: "Notifications", description: "Email and text preferences", icon: Bell },
  { to: "/privacy", label: "Privacy", description: "Privacy policy and data controls", icon: Shield },
];

const MORE_LINKS: Row[] = [
  { to: "/m/progress", label: "Progress Hub", description: "Photos, weight, measurements", icon: Camera },
  { to: "/m/announcements", label: "Announcements", icon: Megaphone },
  { to: "/m/tools", label: "Tools", icon: Wrench },
  { to: "/m/support", label: "Support", description: "Message the team", icon: LifeBuoy },
  { to: "/install", label: "Install App", icon: Download },
];

const DANGER: Row[] = [
  { to: "/account-deletion", label: "Delete Account", icon: Trash2, destructive: true },
];

function Section({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="space-y-2">
      <div className="px-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <Card className="divide-y divide-border/60 overflow-hidden p-0">
        {rows.map((r) => {
          const Icon = r.icon;
          const inner = (
            <div
              className={
                "flex items-center gap-3 px-4 py-3 transition hover:bg-muted/40 " +
                (r.destructive ? "text-destructive" : "")
              }
            >
              <div
                className={
                  "grid h-9 w-9 shrink-0 place-items-center rounded-lg " +
                  (r.destructive
                    ? "bg-destructive/10 text-destructive"
                    : "bg-primary/10 text-primary")
                }
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{r.label}</div>
                {r.description && (
                  <div className="text-xs text-muted-foreground">{r.description}</div>
                )}
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          );
          if (r.to) {
            return (
              <Link key={r.label} to={r.to as any}>
                {inner}
              </Link>
            );
          }
          return (
            <a key={r.label} href={r.href} target={r.external ? "_blank" : undefined} rel="noreferrer">
              {inner}
            </a>
          );
        })}
      </Card>
    </div>
  );
}

function MorePage() {
  const { signOut } = useAuth();
  return (
    <div className="space-y-6 pb-safe-bottom">
      <PageHeader title="More" subtitle="Manage your membership and account." />
      <Section title="Manage Membership" rows={MANAGE} />
      <Section title="More" rows={MORE_LINKS} />
      <Section title="Account" rows={DANGER} />
      <div className="pt-2">
        <Button variant="outline" className="w-full sm:w-auto" onClick={() => signOut()}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </Button>
      </div>
    </div>
  );
}