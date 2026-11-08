/**
 * Refining a proposal by conversation: the model returns only what's new or
 * different (same id = a replacement) and the ids to drop; everything else in
 * the current proposal carries forward exactly as it was, so a small ask
 * never quietly rewrites the rest. Changes the coach unticked are dropped and
 * not offered again. Pure.
 */
import type { EditChange, EditReply } from "./ops";
import type { ProgramSnapshot } from "./types";

export type Merged = { changes: EditChange[]; carried: string[]; replaced: string[]; added: string[]; dropped: string[] };

export function mergeProposal(current: EditChange[], reply: Pick<EditReply, "changes" | "drop">, rejected: string[] = []): Merged {
  const gone = new Set([...rejected, ...reply.drop]);
  const kept = current.filter((c) => !gone.has(c.id));
  const dropped = current.filter((c) => gone.has(c.id)).map((c) => c.id);
  const used = new Set(current.map((c) => c.id));
  const replaced: string[] = [];
  const added: string[] = [];
  let next = 1 + Math.max(0, ...[...used, ...reply.changes.map((c) => c.id)].map((id) => Number(/^c(\d+)$/.exec(id)?.[1] ?? 0)));
  const out = [...kept];
  for (const c of reply.changes) {
    const at = out.findIndex((x) => x.id === c.id);
    if (at >= 0) {
      out[at] = c;
      replaced.push(c.id);
      continue;
    }
    // a new change can't reuse the id of one that was dropped or unticked
    const id = used.has(c.id) || out.some((x) => x.id === c.id) ? `c${next++}` : c.id;
    out.push({ ...c, id });
    added.push(id);
  }
  const carried = kept.map((c) => c.id).filter((id) => !replaced.includes(id));
  return { changes: out, carried, replaced, added, dropped };
}

/** A fingerprint of the program as read: any edit, log or new lock since changes it. */
export function snapshotFingerprint(snap: ProgramSnapshot): string {
  const parts: string[] = [snap.kind, String(snap.revision ?? ""), snap.trainingDays.join(",")];
  for (const b of snap.blocks)
    for (const w of b.weeks)
      for (const d of w.days) {
        parts.push(`${d.id}:${d.updatedAt ?? ""}:${d.lock ?? ""}:${d.dayIndex}`);
        for (const r of d.rows) parts.push(`${r.id}:${r.updatedAt ?? ""}:${r.sortOrder}`);
      }
  // FNV-1a, 32-bit, twice with different seeds
  const hash = (seed: number) => {
    let h = seed >>> 0;
    for (const s of parts)
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
    return h.toString(16).padStart(8, "0");
  };
  return `${hash(2166136261)}${hash(0x9747b28c)}`;
}

export type Turn = { instruction: string; status: string; result: any | null; rejected: string[] };

/** The conversation so far, for the model: what the coach asked and what was proposed or answered. */
export function conversationText(turns: Turn[], current: EditChange[], programChanged: boolean): string {
  if (!turns.length) return "";
  const lines: string[] = [];
  turns.forEach((t, i) => {
    lines.push(`Turn ${i + 1}. The coach: "${t.instruction}"`);
    const r = t.result;
    if (r?.answer) lines.push(`You answered: ${String(r.answer).slice(0, 1500)}`);
    if (r?.changes?.length) lines.push(`You proposed: ${(r.changes as any[]).map((c) => `${c.id} "${c.title}"`).join("; ")}`);
    if (t.rejected.length) lines.push(`The coach unticked: ${t.rejected.join(", ")}`);
    if (t.status === "error") lines.push("(That turn failed.)");
  });
  if (current.length) {
    if (programChanged) {
      lines.push(
        "",
        "THE PROGRAM CHANGED since the last proposal (it was edited or trained), so the proposal below was cleared. Propose again what's still wanted, from the program as it is now:",
        ...current.map((c) => `- ${c.title}: ${c.why}`),
      );
    } else {
      lines.push(
        "",
        "CURRENT PROPOSAL (carries forward unless you replace it by id or list its id in drop; never repeat an unchanged change):",
        JSON.stringify(current.map((c) => ({ id: c.id, title: c.title, basis: c.basis, ops: c.ops }))),
      );
    }
  }
  return lines.join("\n");
}
