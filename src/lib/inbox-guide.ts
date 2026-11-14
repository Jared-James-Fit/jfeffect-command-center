/**
 * What each part of the coach's Messages inbox means, in plain words: one
 * place for the line under the filters and the "How Messages works" guide,
 * so they can never say different things.
 */

export type InboxFilterKey =
  | "Inbox" | "Weekly" | "Nutrition" | "To Review" | "Overdue" | "Pain" | "Media" | "Sessions" | "Archived";

/** What a filter shows, one sentence each. */
export const FILTER_HELP: Record<Exclude<InboxFilterKey, "Inbox">, string> = {
  Weekly: "Weekly check-ins a client sent in that you haven't reviewed, and ones that are overdue.",
  Nutrition: "Nutrition Updates a client sent in that you haven't reviewed, and ones that are overdue.",
  "To Review": "Every form a client sent in that you haven't reviewed yet.",
  Overdue: "Forms you sent that are past their due date and not filled in.",
  Pain: "A client said something hurt after a workout. Worth a check-in.",
  Media: "Photos and videos a client sent in the last 2 weeks that you haven't replied to or reacted to.",
  Sessions: "A client asked for a session and is waiting on your answer.",
  Archived: "Chats you archived. One comes back to the Inbox when the client writes.",
};

/** The Inbox's line: how many chats have a new message, the same number as the Messages tab. */
export function inboxHelp(newChats: number): string {
  if (newChats <= 0) return "No new messages. Every chat is here, newest first.";
  return `${newChats} chat${newChats === 1 ? " has a new message" : "s have new messages"} (the blue dot). Every chat is here, newest first.`;
}

export function filterHelp(filter: InboxFilterKey, newChats: number): string {
  return filter === "Inbox" ? inboxHelp(newChats) : FILTER_HELP[filter];
}

/** The guide's sections, in the order a coach meets them. */
export const GUIDE_BADGE =
  "How many chats have a new message from a client that you haven't read. The Inbox chip shows the same number. Forms and check-ins never add to it: they have their own filters. Opening the chat clears it.";

export const GUIDE_ROW: { title: string; body: string }[] = [
  { title: "Blue dot and bold name", body: "A new message you haven't read. Swipe left to mark a chat read or unread." },
  { title: "The line under a name", body: "What's waiting on you, most important first: red is pain, amber is overdue, blue is something to review." },
  { title: "Their photo or that line", body: "Opens the Brief: everything waiting on you for that client, with a short summary." },
  { title: "Swipe a chat left", body: "Read or Unread, Done when no reply is needed, and Archive for a chat that's finished." },
];

export const GUIDE_FILTERS_NOTE = "A filter only shows while something's in it. Its number is how many clients are in it, in the colour of their line: red is pain, amber is overdue, blue is something to review.";
