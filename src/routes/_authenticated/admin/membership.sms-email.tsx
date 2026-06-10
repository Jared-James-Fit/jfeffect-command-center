import { createFileRoute, Link } from "@tanstack/react-router";
import { MembershipLeaf } from "@/components/admin/membership-leaf";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageCircle, Mail, Link2, KeyRound, Megaphone } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/membership/sms-email")({
  component: SmsEmailToolsPage,
});

function ToolRow({ icon: Icon, title, body, to }: { icon: any; title: string; body: string; to: string }) {
  return (
    <div className="flex items-start gap-3 p-3">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-secondary text-foreground"><Icon className="h-4 w-4" /></div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold">{title}</div>
        <div className="text-xs text-muted-foreground">{body}</div>
      </div>
      <Link to={to as any}><Button size="sm" variant="outline">Open</Button></Link>
    </div>
  );
}

function SmsEmailToolsPage() {
  return (
    <MembershipLeaf title="SMS / Email Tools" subtitle="Reach members with setup, reset, welcome, and billing messages.">
      <Card className="divide-y divide-border">
        <ToolRow icon={Link2} title="Send setup links" body="Generate setup links for members who haven't created their account." to="/admin/membership/setup-links" />
        <ToolRow icon={KeyRound} title="Send password reset links" body="Generate a password reset link for any member by email." to="/admin/membership/reset-links" />
        <ToolRow icon={Megaphone} title="Welcome messages" body="Manage welcome / billing-issue / trial-ending message templates." to="/admin/membership/welcome-messages" />
        <ToolRow icon={MessageCircle} title="SMS settings" body="Configure how SMS is sent and which automations fire." to="/admin/settings/sms" />
        <ToolRow icon={Mail} title="Broadcasts" body="Send member-wide email or in-app announcements." to="/admin/broadcasts" />
      </Card>
      <p className="text-[11px] text-muted-foreground">
        SMS only sends to members with a phone number, SMS consent enabled, and no opt-out. SMS-based password reset isn't supported by the auth provider; reset links are email-only.
      </p>
    </MembershipLeaf>
  );
}