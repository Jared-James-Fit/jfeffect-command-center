import { createFileRoute } from "@tanstack/react-router";
import { ShareToolbar } from "@/components/sales/share-toolbar";

export const Route = createFileRoute("/_authenticated/media/promo-links")({
  component: () => (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <h1 className="text-2xl font-black">Promo Links</h1>
      <p className="text-sm text-muted-foreground">Public share links for /join and /coaching.</p>
      <ShareToolbar slug="join" />
      <ShareToolbar slug="coaching" />
    </div>
  ),
});