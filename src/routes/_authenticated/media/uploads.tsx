import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/media/uploads")({
  component: () => (
    <div className="mx-auto max-w-3xl p-4 md:p-6 space-y-4">
      <h1 className="text-2xl font-black">Uploads</h1>
      <Card className="p-4 text-sm text-muted-foreground">
        Upload tools for marketing/public assets coming soon. For now, ask admin to upload and tag files as marketing or public.
      </Card>
    </div>
  ),
});