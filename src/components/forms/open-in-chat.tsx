/**
 * "Open in chat": the coach's chat with a client, on the message a submitted
 * check-in or form sits on (scrolled to and highlighted; submission-message.ts).
 * Its own file so the responses viewer and the review sheets share it without
 * importing each other.
 */
import { Link } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chatSearch, useSubmissionMessage, type SubmissionRef } from "@/lib/submission-message";
import { cn } from "@/lib/utils";

/**
 * "Open in chat": the coach's chat with them, on the message the submission
 * sits on. The message is found as soon as this shows, so the tap is instant;
 * until then (or when there's none) it opens the chat at its latest message.
 */
export function OpenInChatButton({
  subRef,
  onLeave,
  label = "Open in chat",
  className,
  variant = "outline",
  size,
}: {
  subRef: SubmissionRef;
  onLeave?: () => void;
  label?: string;
  className?: string;
  variant?: "outline" | "default";
  size?: "sm";
}) {
  const { data: msg } = useSubmissionMessage(subRef);
  return (
    <Button asChild variant={variant} size={size} className={cn("h-11", className)}>
      <Link
        to="/admin/messages"
        search={chatSearch(subRef.clientId, msg) as any}
        onClick={() => onLeave?.()}
        data-open-in-chat
        aria-label={label}
      >
        <MessageCircle className="mr-1.5 h-4 w-4" /> {label}
      </Link>
    </Button>
  );
}

