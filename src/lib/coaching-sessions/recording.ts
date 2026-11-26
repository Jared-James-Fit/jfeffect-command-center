/**
 * A meeting recording's words (pure, tested in meeting-recording.test.ts):
 * the parts' timestamped segments as one transcript, with the speakers the
 * coach confirmed and "Speaker A" for the rest (never a guess), the
 * speakers worth naming, and how many people seem to be talking.
 *
 * A speaker label is per part ("0:A" is part 0's speaker A) unless the part
 * was transcribed with the first part's voice samples, when the same label
 * means the same person in every part ("*:A").
 */

export type PartSegment = { start: number; end: number; speaker: string | null; text: string };
export type AudioPart = {
  seq: number;
  offset_ms: number;
  duration_ms?: number | null;
  status: string;
  transcript?: { segments?: PartSegment[]; consistent?: boolean } | null;
};
export type SpeakerRole = "coach" | "client" | "other";
export type SpeakerMap = Record<string, { role: SpeakerRole; name?: string | null }>;
export type Participant = { role: SpeakerRole; name: string | null };

/** The key a part's speaker label is mapped under. */
export function speakerKey(
  part: Pick<AudioPart, "seq" | "transcript">,
  label: string | null,
): string | null {
  if (!label) return null;
  return part.transcript?.consistent ? `*:${label}` : `${part.seq}:${label}`;
}

const letter = (i: number) => String.fromCharCode(65 + (i % 26));

/** How a speaker is written: the coach's choice, else a neutral label in order of first appearance. */
export function speakerName(
  key: string | null,
  map: SpeakerMap,
  order: Map<string, number>,
  participants: Participant[] = [],
): string {
  if (!key) return "Unknown speaker";
  const m = map[key];
  if (m) {
    if (m.name?.trim()) return m.name.trim();
    if (m.role === "coach") return "Coach";
    if (m.role === "client")
      return participants.find((p) => p.role === "client")?.name?.trim() || "Client";
    return "Other participant";
  }
  return `Speaker ${letter(order.get(key) ?? 0)}`;
}

/** "12:05" from seconds. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

export type Line = {
  seq: number;
  index: number;
  at: number;
  end: number;
  key: string | null;
  speaker: string;
  text: string;
};

/** Every line, in order, with its time from the start of the meeting. */
export function transcriptLines(
  parts: AudioPart[],
  map: SpeakerMap,
  participants: Participant[] = [],
): Line[] {
  const order = new Map<string, number>();
  const out: Line[] = [];
  for (const p of [...parts].sort((a, b) => a.seq - b.seq)) {
    const segs = p.transcript?.segments ?? [];
    segs.forEach((g, index) => {
      const key = speakerKey(p, g.speaker);
      if (key && !order.has(key)) order.set(key, order.size);
      out.push({
        seq: p.seq,
        index,
        at: p.offset_ms / 1000 + g.start,
        end: p.offset_ms / 1000 + g.end,
        key,
        speaker: "",
        text: g.text,
      });
    });
  }
  for (const l of out) l.speaker = speakerName(l.key, map, order, participants);
  return out;
}

/** The transcript as the analysis reads it: "[12:05] Coach: …", consecutive lines of one speaker joined. */
export function assembleTranscript(
  parts: AudioPart[],
  map: SpeakerMap,
  participants: Participant[] = [],
): string {
  const lines = transcriptLines(parts, map, participants);
  const out: string[] = [];
  let last: Line | null = null;
  for (const l of lines) {
    if (last && last.key === l.key && l.at - last.end < 4 && out.length) {
      out[out.length - 1] += ` ${l.text}`;
    } else out.push(`[${clock(l.at)}] ${l.speaker}: ${l.text}`);
    last = l;
  }
  return out.join("\n");
}

export type SpeakerSummary = {
  key: string;
  label: string;
  seconds: number;
  sample: string;
  mapped: SpeakerMap[string] | null;
};

/** The speakers worth naming: each with how long they talked and a line of what they said. */
export function speakers(parts: AudioPart[], map: SpeakerMap): SpeakerSummary[] {
  const by = new Map<string, SpeakerSummary>();
  const order = new Map<string, number>();
  for (const p of [...parts].sort((a, b) => a.seq - b.seq))
    for (const g of p.transcript?.segments ?? []) {
      const key = speakerKey(p, g.speaker);
      if (!key) continue;
      if (!order.has(key)) order.set(key, order.size);
      const cur = by.get(key) ?? {
        key,
        label: `Speaker ${letter(order.get(key)!)}${p.transcript?.consistent ? "" : ` (part ${p.seq + 1})`}`,
        seconds: 0,
        sample: "",
        mapped: map[key] ?? null,
      };
      cur.seconds += Math.max(0, g.end - g.start);
      if (cur.sample.length < 60 && g.text.length > cur.sample.length)
        cur.sample = g.text.slice(0, 140);
      by.set(key, cur);
    }
  return [...by.values()].sort((a, b) => order.get(a.key)! - order.get(b.key)!);
}

/** How many people seem to be talking: the most distinct speakers in any one part (or across consistent ones). */
export function participantEstimate(parts: AudioPart[]): number {
  let best = 0;
  const consistent = new Set<string>();
  for (const p of parts) {
    const here = new Set(
      (p.transcript?.segments ?? []).map((g) => g.speaker).filter(Boolean) as string[],
    );
    if (p.transcript?.consistent) here.forEach((x) => consistent.add(x));
    best = Math.max(best, here.size);
  }
  return Math.max(best, consistent.size);
}

/** Every speaker who said much (10% of the talking) is named by the coach. */
export function speakersConfirmed(list: SpeakerSummary[]): boolean {
  const total = list.reduce((a, s) => a + s.seconds, 0);
  if (!list.length) return false;
  return list.filter((s) => s.seconds >= total * 0.1).every((s) => !!s.mapped);
}
