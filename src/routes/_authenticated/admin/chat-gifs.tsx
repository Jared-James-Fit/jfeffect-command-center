import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ChatGifsSettingsPage } from "@/route-pages/_authenticated/admin/chat-gifs";

export const Route = createFileRoute("/_authenticated/admin/chat-gifs")({
  component: ChatGifsSettingsPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">Couldn't load: {String(error)}</p>
        <Button onClick={() => { reset(); router.invalidate(); }}>Retry</Button>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-6 text-sm">Not found.</div>,
});
