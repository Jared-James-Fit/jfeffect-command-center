import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/media/announcements")({
  component: () => (
    <div className="mx-auto max-w-3xl p-4 md:p-6 space-y-4">
      <h1 className="text-2xl font-black">Announcement Drafts</h1>
      <Card className="p-4 text-sm text-muted-foreground">
        Announcements share the same broadcast pipeline. Create your draft in
        <Link to="/media/broadcasts" className="underline ml-1">Broadcast Drafts</Link>
        and admin will approve before publishing.
      </Card>
    </div>
  ),
});