/**
 * What the lift finder did with a clip (lift.ts writes it, by the picked file
 * itself): the trimmer reads why there's no suggestion, and a set video's
 * upload carries it (`pl_set_videos.transfer.lift`), so a real phone's "it
 * didn't find my lift" can be read back instead of guessed at. Tiny on
 * purpose: nothing here loads the video engine.
 */
import type { VideoTrim } from "@/lib/video-edit/plan";

export type LiftWhy =
  | "found"
  | "few-frames"
  /** The frames it could read were too far apart to trust. */
  | "sparse"
  | "handheld"
  | "no-movement"
  | "no-lift"
  | "unclear"
  | "short"
  | "nothing-to-cut"
  /** Out of time before it had read the clip. */
  | "slow"
  /** This phone can't decode the clip, or the clip is too short or too long to read. */
  | "cant-read"
  | "stopped"
  | "error";

export type LiftNote = {
  /** How long it took. */
  ms: number;
  /** Frames it read. */
  n: number;
  /** How it read them: the clip's keyframes, keyframes with the gaps filled in, or a frame a second decoded straight through. */
  mode: "keys" | "keys+fill" | "grid" | "none";
  /** Seconds between the clip's keyframes, on average. */
  key_s: number | null;
  why: LiftWhy;
  /** The part it suggested. */
  win: [number, number] | null;
};

const notes = new WeakMap<Blob, LiftNote>();

export function noteLift(file: Blob, note: LiftNote) {
  notes.set(file, note);
}

export function liftNoteFor(file: Blob | null | undefined): LiftNote | null {
  return (file && notes.get(file)) || null;
}

/** It looked and there's a lift it couldn't pick out (never "nothing worth cutting", which needs no words). */
export function liftNotFound(note: LiftNote | null): boolean {
  return !!note && !note.win && note.why !== "nothing-to-cut" && note.why !== "stopped";
}

/**
 * For an upload's record, one short line: what the finder did and whether
 * what went is what it suggested (within a few tenths), e.g.
 * "found keys+fill key2.0 n52 3140ms 3.1-14.2 kept", "slow grid key- n20 12004ms".
 */
export function liftTransferNote(file: Blob | null | undefined, sent: VideoTrim | null, duration: number): string | null {
  const note = liftNoteFor(file);
  if (!note) return null;
  const head = `${note.why} ${note.mode} key${note.key_s ?? "-"} n${note.n} ${note.ms}ms`;
  if (!note.win) return head;
  const sel = sent ?? { start: 0, end: duration };
  const kept = Math.abs(sel.start - note.win[0]) <= 0.35 && Math.abs(sel.end - note.win[1]) <= 0.35;
  return `${head} ${note.win[0]}-${note.win[1]} ${kept ? "kept" : "changed"}`;
}
