export type AssetProvider =
  | "google_drive" | "google_docs" | "google_sheets" | "google_slides"
  | "dropbox" | "onedrive" | "canva" | "youtube" | "vimeo" | "loom"
  | "frameio" | "figma" | "notion" | "link";

export function detectProvider(url: string): AssetProvider {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    const p = u.pathname.toLowerCase();
    if (h.includes("docs.google.com")) {
      if (p.includes("/document/")) return "google_docs";
      if (p.includes("/spreadsheets/")) return "google_sheets";
      if (p.includes("/presentation/")) return "google_slides";
      return "google_docs";
    }
    if (h.includes("drive.google.com")) return "google_drive";
    if (h.includes("dropbox.com")) return "dropbox";
    if (h.includes("onedrive.live.com") || h.includes("1drv.ms") || h.includes("sharepoint.com")) return "onedrive";
    if (h.includes("canva.com")) return "canva";
    if (h.includes("youtube.com") || h.includes("youtu.be")) return "youtube";
    if (h.includes("vimeo.com")) return "vimeo";
    if (h.includes("loom.com")) return "loom";
    if (h.includes("frame.io")) return "frameio";
    if (h.includes("figma.com")) return "figma";
    if (h.includes("notion.so") || h.includes("notion.site")) return "notion";
  } catch {}
  return "link";
}

export const PROVIDER_META: Record<AssetProvider, { label: string; emoji: string }> = {
  google_drive: { label: "Google Drive", emoji: "🟡" },
  google_docs:  { label: "Google Docs",  emoji: "📄" },
  google_sheets:{ label: "Google Sheets",emoji: "📊" },
  google_slides:{ label: "Google Slides",emoji: "🖼" },
  dropbox:      { label: "Dropbox",      emoji: "🔵" },
  onedrive:     { label: "OneDrive",     emoji: "🟦" },
  canva:        { label: "Canva",        emoji: "🎨" },
  youtube:      { label: "YouTube",      emoji: "▶️" },
  vimeo:        { label: "Vimeo",        emoji: "🎬" },
  loom:         { label: "Loom",         emoji: "💬" },
  frameio:      { label: "Frame.io",     emoji: "🎞" },
  figma:        { label: "Figma",        emoji: "🅵" },
  notion:       { label: "Notion",       emoji: "📝" },
  link:         { label: "Link",         emoji: "🔗" },
};

export function safeUrl(s: string): string | null {
  try { const u = new URL(s); if (u.protocol === "http:" || u.protocol === "https:") return u.toString(); }
  catch {}
  return null;
}
