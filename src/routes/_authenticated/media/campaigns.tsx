import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/media/campaigns")({
  component: () => (
    <div className="mx-auto max-w-5xl p-4 md:p-6 space-y-4">
      <h1 className="text-2xl font-black">Campaigns & Promos</h1>
      <Card className="p-4 text-sm text-muted-foreground">
        Track active promo campaigns. Connects to sales pages and broadcast drafts.
      </Card>
    </div>
  ),
});