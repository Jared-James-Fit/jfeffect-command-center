import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ClientLiftVideoUploader } from "@/components/client-lift-video-uploader";
import { Video } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  clientName?: string | null;
  userId: string | null;
};

/**
 * Post-workout opportunity to send a lift video for coach review.
 * Fully optional — large "Maybe later" + close (X) make it easy to dismiss.
 * Coaching clients only (rendered from /portal/* routes, never /m/*).
 */
export function PostWorkoutLiftPrompt({ open, onOpenChange, clientId, clientName, userId }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[95vw] max-w-2xl overflow-y-auto p-0">
        <div className="px-5 pt-5">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle className="flex items-center gap-2 text-xl font-black">
              <Video className="h-5 w-5 text-primary" />
              Send a lift for review?
            </DialogTitle>
            <DialogDescription>
              Optional — drop a video or photo from today's session and Jared will give feedback. Skip if you're not ready.
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="px-5 pb-2 pt-4">
          <ClientLiftVideoUploader
            clientId={clientId}
            clientName={clientName}
            userId={userId}
            onSaved={() => onOpenChange(false)}
          />
        </div>
        <div className="sticky bottom-0 z-10 flex justify-end border-t bg-background/95 px-5 py-3 backdrop-blur">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Maybe later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}