import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/media/calendar")({
  component: () => (
    <div className="mx-auto max-w-5xl p-4 md:p-6 space-y-4">
      <h1 className="text-2xl font-black">Content Calendar</h1>
      <Card className="p-4 text-sm text-muted-foreground">
        Plan content shoots, posts, and campaigns. Calendar view connects to scheduled events and broadcast drafts.
      </Card>
    </div>
  ),
});