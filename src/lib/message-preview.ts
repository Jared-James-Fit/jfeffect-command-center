/**
 * One line for what a message says, the way iMessage previews it: the words,
 * or what was sent ("📷 Photo", "🎥 2 Videos", "🎤 Voice memo") when there are
 * none. Used where a chat shows its newest message outside the thread.
 */
type Att = { type?: string | null; kind?: string | null; story?: boolean | null; reply?: boolean | null } | null | undefined;

const plural = (n: number, one: string, many: string) => (n > 1 ? `${n} ${many}` : one);

export function messagePreviewText(body: string | null | undefined, attachments: unknown): string {
  const text = (body ?? "").replace(/\s+/g, " ").trim();
  if (text) return text;
  const list = (Array.isArray(attachments) ? attachments : []) as Att[];
  if (!list.length) return "";
  const first = list.find(Boolean);
  if (first?.kind === "community_post") return first.story ? "Replied to a story" : "Shared a post";
  if (first?.kind === "form_request") return "📋 A form to fill in";
  if (first?.kind === "payment_request") return "💳 Payment request";
  if (first?.kind === "signature_request") return "✍️ Something to sign";
  if (first?.kind === "recipe_share") return "🍽️ Shared a recipe";
  if (first?.kind === "gif") return "GIF";
  if (first?.kind === "sound") return "🔊 Sound";
  const images = list.filter((a) => a?.type === "image").length;
  const videos = list.filter((a) => a?.type === "video").length;
  if (images && videos) return `📷 ${images + videos} Photos & Videos`;
  if (images) return `📷 ${plural(images, "Photo", "Photos")}`;
  if (videos) return `🎥 ${plural(videos, "Video", "Videos")}`;
  if (list.some((a) => a?.type === "audio")) return "🎤 Voice memo";
  if (list.some((a) => a?.type === "pdf" || a?.type === "file")) return "📄 File";
  return "📎 Attachment";
}
