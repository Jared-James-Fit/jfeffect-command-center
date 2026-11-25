/**
 * How a group chat reads in a list, the coach's and the client's alike
 * (coach-run groups and members' crews): its name (or one made from who's in
 * it), its faces, and the latest message with who sent it, the way a 1:1 row
 * reads. Pure, so every list and its tests agree.
 */
import { messagePreviewText } from "@/lib/message-preview";

/** The most faces a group's picture shows; past that the last spot is "+N". */
export const GROUP_FACES_MAX = 4;

export type GroupFace = { user_id: string; name: string; avatar_url: string | null };

/** Which faces the picture draws and the "+N" for everyone else (`total` = everyone it could show). */
export function clusterFaces<T>(faces: readonly T[], total = faces.length): { shown: T[]; more: number } {
  const all = Math.max(total, faces.length);
  if (all <= GROUP_FACES_MAX) return { shown: faces.slice(0, GROUP_FACES_MAX), more: 0 };
  const shown = faces.slice(0, GROUP_FACES_MAX - 1);
  return { shown, more: all - shown.length };
}

/** A first name for lists ("Marc Asugui" → "Marc"). */
export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/**
 * The group's own name, else one made from who's in it, iMessage's way:
 * "Marc", "Marc and Devin", "Marc, Devin and Nicole", "Marc, Devin and 3 others".
 */
export function groupDisplayName(name: string | null | undefined, people: readonly { name: string | null }[], total = people.length): string {
  const own = (name ?? "").trim();
  if (own) return own;
  const firsts = people.map((p) => firstName(p.name)).filter(Boolean);
  const all = Math.max(total, firsts.length);
  if (!firsts.length) return "Group chat";
  if (all === 1) return firsts[0];
  if (all === 2 && firsts.length >= 2) return `${firsts[0]} and ${firsts[1]}`;
  if (all === 3 && firsts.length >= 3) return `${firsts[0]}, ${firsts[1]} and ${firsts[2]}`;
  const named = firsts.slice(0, 2);
  const others = all - named.length;
  return `${named.join(", ")} and ${others} other${others === 1 ? "" : "s"}`;
}

export type GroupLastMessage = {
  body?: string | null;
  attachments?: unknown;
  sender_id?: string | null;
  sender_role?: string | null;
  /** Their name when the read already has it (a crew's last message). */
  sender_name?: string | null;
  deleted_at?: string | null;
} | null | undefined;

/**
 * The row's second line: "You: …", "Marc: …", or an update on its own
 * ("Devin joined"), with "📷 Photo", "🎥 Video", "🎤 Voice memo" or
 * "📄 File" when there are no words.
 */
export function groupPreview(last: GroupLastMessage, me: string | null | undefined, nameOf?: (userId: string) => string | null | undefined): string {
  if (!last) return "No messages yet";
  if (last.deleted_at) return "Message unsent";
  const text = messagePreviewText(last.body, last.attachments) || "Message";
  if (last.sender_role === "system" || !last.sender_id) return text;
  if (last.sender_id === me) return `You: ${text}`;
  const who = firstName(last.sender_name ?? nameOf?.(last.sender_id) ?? "");
  return who ? `${who}: ${text}` : text;
}
