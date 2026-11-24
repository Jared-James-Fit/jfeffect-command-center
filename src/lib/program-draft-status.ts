import type { ProgramDraft } from "@/lib/athlete-programs";

/**
 * Where the builder's work stands, said once, quietly, by the program's name
 * (Nov 24 2026): never a pop-up over the builder.
 *
 *   restored  the unsaved draft from last time (this device or another) is back
 *   saving    an edit is on its way to the server
 *   draft     every edit is kept on the server; Save puts it in the program
 *   offline   no connection: kept on this device, sent once it's back
 *   device    kept on this device only (an import being checked, or the server
 *             can't keep drafts yet)
 *   saved     nothing unsaved: the program is as saved
 *   new       a new program with nothing in it yet
 */
export type DraftStatus = "restored" | "saving" | "draft" | "offline" | "device" | "saved" | "new";

export const DRAFT_STATUS_WORDS: Record<
  DraftStatus,
  { text: string; tone: "quiet" | "good" | "warn" }
> = {
  restored: { text: "Draft restored", tone: "good" },
  saving: { text: "Saving…", tone: "quiet" },
  draft: { text: "Draft saved", tone: "good" },
  offline: { text: "Offline · saved on this device", tone: "warn" },
  device: { text: "Saved on this device", tone: "quiet" },
  saved: { text: "All changes saved", tone: "good" },
  new: { text: "Not saved yet", tone: "quiet" },
};

/** What each status means, for its tooltip and screen readers. */
export const DRAFT_STATUS_HINT: Record<DraftStatus, string> = {
  restored:
    "Your unsaved changes from last time are back. Save to put them in your program, or discard them from ⋯.",
  saving: "Keeping your latest change.",
  draft:
    "Your changes are kept, here and on your other devices. Tap Save to put them in your program.",
  offline: "You're offline. Your changes are kept on this device and sent once you're back online.",
  device: "Your changes are kept on this device until you save.",
  saved: "Your program is up to date.",
  new: "Add exercises, then Save.",
};

type Kept = { draft: ProgramDraft; at: number };
type Remote = { draft: ProgramDraft; base: string | null; updated_at: string };

/**
 * The draft to pick up when the builder opens: the newer of the device's copy
 * and the server's, only when it was made from the program as it is now
 * (`base`) and differs from it. Null: open the program as saved.
 */
export function pickDraft({
  initial,
  base,
  local,
  remote,
  same,
}: {
  initial: ProgramDraft;
  base: string | null;
  local: Kept | null;
  remote: Remote | null;
  same: (a: ProgramDraft, b: ProgramDraft) => boolean;
}): ProgramDraft | null {
  const options: Kept[] = [];
  if (local) options.push(local);
  if (remote && (remote.base ?? null) === base) {
    const at = Date.parse(remote.updated_at);
    options.push({ draft: remote.draft, at: Number.isFinite(at) ? at : 0 });
  }
  const newest = options.sort((a, b) => b.at - a.at)[0];
  if (!newest || same(newest.draft, initial)) return null;
  return newest.draft;
}
