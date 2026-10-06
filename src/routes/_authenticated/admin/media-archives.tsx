import { createFileRoute } from "@tanstack/react-router";
import { MediaArchivesRedirect } from "@/route-pages/_authenticated/admin/media-archives";

export const Route = createFileRoute("/_authenticated/admin/media-archives")({
  component: MediaArchivesRedirect,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">Couldn't load media archives: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-8">Not found.</div>,
});
