/**
 * Set videos filmed in the app and not saved to the phone yet.
 *
 * A clip recorded through the phone's own Take Video (the set's camera opens
 * the Take Video / Photo Library sheet) never lands in Photos: iOS hands the
 * page the recording and nothing else, and a web page or the app's web view
 * can only put a video in Photos through the share sheet's Save Video, opened
 * from a tap. So the app offers it: right after filming, on the clip, before
 * it's removed, and at the end of the workout (set-video-phone-copy.tsx).
 *
 * This is what it remembers, per login: the clip itself while the app stays
 * open, and a small record on the phone (localStorage) so a reload still
 * knows which clips were filmed here and not saved (those come back down from
 * storage to save). Light on purpose: no video code, read by the set rows.
 *
 * Nov 12 2026: Fionna filmed her hip thrust set in the app, then removed it
 * from the set thinking it was on her phone. It wasn't.
 */
import { useMemo, useSyncExternalStore } from "react";

/** A record older than this stops being offered (the outbox keeps clips as long). */
export const PHONE_COPY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 60;
const KEY = (userId: string) => `jf-set-video-phone-copy:${userId}`;

export type FilmedEntry = {
  /** The upload's job id (set-videos/jobs.ts). */
  jobId: string;
  /** The set video once it's recorded (pl_set_videos.id). */
  setVideoId: string | null;
  dayId: string;
  /** When it was filmed (picked). */
  at: number;
};

/**
 * Did this clip come straight from the camera (filmed in the app), as far as
 * its name can tell? A pick from Photos keeps the phone's own name: iPhone
 * library clips are IMG_1234.MOV, or video-output-<id>.MOV for an edited one;
 * screen recordings and other apps' clips have their own; Android's photo
 * picker hands out numbered files (1000019729.mp4) and its cameras date
 * stamps. Anything else is treated as filmed here: an extra "Save" offer
 * costs a tap, a clip that's nowhere but the app costs the clip.
 */
export function looksFilmedInApp(file: { name?: string | null }): boolean {
  const name = (file.name ?? "").trim();
  if (!name) return true;
  const library = [
    /^IMG_\d+/i, // iPhone Photos
    /^IMG-\d{8}/i, // WhatsApp and friends
    /^video-output-/i, // an edited iPhone clip, exported from Photos
    /^trim\./i, // a clip iOS trimmed / compressed on its way out of Photos
    /^RPReplay/i, // iPhone screen recording
    /^ScreenRecording/i,
    /^Screen[ _]Recording/i,
    /^\d{6,}\.[a-z0-9]{2,4}$/i, // Android photo picker (MediaStore ids)
    /^PXL_\d{8}/i, // Pixel camera, from the gallery
    /^\d{8}_\d{6}/, // Samsung camera, from the gallery
  ];
  return !library.some((re) => re.test(name));
}

/* ------------------------------- the store ------------------------------- */

/** This session's clips themselves (gone after a reload: storage has them then). */
const files = new Map<string, File>();
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  for (const l of listeners) l();
};

function read(userId: string, now = Date.now()): FilmedEntry[] {
  if (typeof localStorage === "undefined" || !userId) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(userId)) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (e): e is FilmedEntry =>
        !!e && typeof e.jobId === "string" && typeof e.dayId === "string" && typeof e.at === "number" && now - e.at < PHONE_COPY_MAX_AGE_MS,
    );
  } catch {
    return [];
  }
}

function write(userId: string, list: FilmedEntry[]) {
  if (typeof localStorage === "undefined" || !userId) return;
  try {
    const kept = list.slice(-MAX_ENTRIES);
    if (kept.length) localStorage.setItem(KEY(userId), JSON.stringify(kept));
    else localStorage.removeItem(KEY(userId));
  } catch {
    /* private mode / full: this session still has the files */
  }
}

/** A clip filmed in the app, just picked: remember it until it's saved. */
export function noteFilmed(userId: string, entry: { jobId: string; dayId: string; file?: File | null }, now = Date.now()) {
  if (!userId || !entry.jobId) return;
  if (entry.file) files.set(entry.jobId, entry.file);
  const list = read(userId, now).filter((e) => e.jobId !== entry.jobId);
  list.push({ jobId: entry.jobId, setVideoId: null, dayId: entry.dayId, at: now });
  write(userId, list);
  emit();
}

/** Its upload landed: the set video it became (so a reload can fetch it from storage). */
export function linkFilmed(userId: string, jobId: string, setVideoId: string | null | undefined) {
  if (!userId || !jobId || !setVideoId) return;
  const list = read(userId);
  const i = list.findIndex((e) => e.jobId === jobId);
  if (i < 0 || list[i].setVideoId === setVideoId) return;
  list[i] = { ...list[i], setVideoId };
  write(userId, list);
  emit();
}

/** Saved to the phone (or let go of on purpose: the upload cancelled, the clip removed): stop offering it. */
export function forgetFilmed(userId: string, ids: { jobIds?: string[]; setVideoIds?: string[] }) {
  const jobs = new Set(ids.jobIds ?? []);
  const vids = new Set(ids.setVideoIds ?? []);
  if (!jobs.size && !vids.size) return;
  const list = read(userId);
  const next = list.filter((e) => !jobs.has(e.jobId) && !(e.setVideoId && vids.has(e.setVideoId)));
  for (const e of list) if (!next.includes(e)) files.delete(e.jobId);
  for (const j of jobs) files.delete(j);
  if (next.length !== list.length) write(userId, next);
  emit();
}

/** The clip itself, while this app open still has it. */
export function filmedFile(jobId: string): File | null {
  return files.get(jobId) ?? null;
}

/** Every clip filmed here and not saved yet (this login's, newest last). */
export function unsavedFilmed(userId: string | null | undefined): FilmedEntry[] {
  return userId ? read(userId) : [];
}

/** The same, kept up to date for what's on screen (a new list only when something changed). */
export function useUnsavedFilmed(userId: string | null | undefined): FilmedEntry[] {
  // the version changes on every write; the list is read again only then
  const v = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      const onStorage = (e: StorageEvent) => {
        if (userId && e.key === KEY(userId)) emit();
      };
      if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(l);
        if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
      };
    },
    () => version,
    () => 0,
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => unsavedFilmed(userId), [userId, v]);
}

/** Test hook. */
export function _resetPhoneCopy() {
  files.clear();
  version = 0;
}
