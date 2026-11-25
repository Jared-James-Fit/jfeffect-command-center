/**
 * A meeting's recording, server side (Nov 25 2026, docs/COACHING_SESSIONS.md):
 * the parts the coach's recorder uploads (coaching_session_audio, private
 * bucket `coaching-recordings`) become timestamped, speaker-labelled lines,
 * and once every part is in, one transcript the analysis reads.
 *
 *  - Transcription is OpenAI's diarizing model (gpt-4o-transcribe-diarize,
 *    `diarized_json`), consistent speakers across parts when the recorder sent
 *    short voice samples from the first part (known speakers); else each part's
 *    own labels. Whisper (no speakers) is the fallback. OpenAI key only, never
 *    Lovable credits; every call is logged in ai_call_log.
 *  - A client who hasn't allowed AI processing: the parts wait
 *    (`waiting_consent`) and are transcribed once they allow it.
 *  - Speakers are never guessed: a label is "Speaker A" until the coach says
 *    who it is; the analysis is told unnamed speakers are unclear.
 *  - The provider being down or out of credits never uses an attempt.
 */
import { assembleTranscript, type AudioPart, type SpeakerMap } from "./recording";

type Db = any;
const BUCKET = "coaching-recordings";
const MAX_ATTEMPTS = 4;
const STALE_MS = 4 * 60_000;
export const DIARIZE_MODEL = "gpt-4o-transcribe-diarize";

export type Segment = { start: number; end: number; speaker: string | null; text: string };

const extOf = (mime: string) =>
  /mp4|m4a|aac/i.test(mime)
    ? "m4a"
    : /ogg/i.test(mime)
      ? "ogg"
      : /wav/i.test(mime)
        ? "wav"
        : "webm";

/** The model's answer as segments (diarized_json, or Whisper's verbose_json). */
export function readSegments(json: any): Segment[] {
  const raw = Array.isArray(json?.segments) ? json.segments : [];
  const out: Segment[] = [];
  for (const s of raw) {
    const text = typeof s?.text === "string" ? s.text.trim() : "";
    if (!text) continue;
    const start = Number(s?.start);
    const end = Number(s?.end);
    out.push({
      start: Number.isFinite(start) ? Math.max(0, start) : 0,
      end: Number.isFinite(end) ? Math.max(0, end) : Number.isFinite(start) ? start : 0,
      speaker:
        typeof s?.speaker === "string" && s.speaker.trim() ? s.speaker.trim().slice(0, 40) : null,
      text: text.slice(0, 2000),
    });
  }
  if (!out.length && typeof json?.text === "string" && json.text.trim())
    out.push({ start: 0, end: 0, speaker: null, text: json.text.trim().slice(0, 20000) });
  return out;
}

async function transcribe(
  key: string,
  bytes: Uint8Array,
  mime: string,
  refs: Array<{ name: string; dataUrl: string }>,
  signal: AbortSignal,
): Promise<{ segments: Segment[]; model: string }> {
  const call = async (model: string, withRefs: boolean) => {
    const form = new FormData();
    form.append(
      "file",
      new Blob([bytes as BlobPart], { type: mime.split(";")[0] || "audio/webm" }),
      `part.${extOf(mime)}`,
    );
    form.append("model", model);
    form.append("language", "en");
    if (model === DIARIZE_MODEL) {
      form.append("response_format", "diarized_json");
      form.append("chunking_strategy", "auto");
      if (withRefs)
        for (const r of refs.slice(0, 4)) {
          form.append("known_speaker_names[]", r.name);
          form.append("known_speaker_references[]", r.dataUrl);
        }
    } else {
      form.append("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "segment");
    }
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal,
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 300);
      const e: any = new Error(`${res.status} ${body}`);
      e.status = res.status;
      throw e;
    }
    return readSegments(await res.json());
  };
  try {
    return { segments: await call(DIARIZE_MODEL, refs.length > 0), model: DIARIZE_MODEL };
  } catch (e: any) {
    // voice samples the model refused: the same part without them
    if (refs.length && e?.status === 400) {
      try {
        return { segments: await call(DIARIZE_MODEL, false), model: DIARIZE_MODEL };
      } catch {
        /* fall through to Whisper */
      }
    }
    if (e?.status === 401 || e?.status === 429 || (e?.status ?? 0) >= 500) throw e;
    return { segments: await call("whisper-1", false), model: "whisper-1" };
  }
}

/** Voice samples for known speakers, read from the bucket as data URLs (2–10 s WAVs the recorder made). */
async function speakerRefs(
  sb: Db,
  recording: any,
): Promise<Array<{ name: string; dataUrl: string }>> {
  const refs = Array.isArray(recording?.speaker_refs) ? recording.speaker_refs : [];
  const out: Array<{ name: string; dataUrl: string }> = [];
  for (const r of refs.slice(0, 4)) {
    if (!r?.path || !r?.name) continue;
    const { data, error } = await sb.storage.from(BUCKET).download(r.path);
    if (error || !data) continue;
    const buf = Buffer.from(new Uint8Array(await data.arrayBuffer()));
    if (buf.length > 400_000) continue;
    out.push({
      name: String(r.name).slice(0, 40),
      dataUrl: `data:audio/wav;base64,${buf.toString("base64")}`,
    });
  }
  return out;
}

/** Transcribe uploaded parts (claimed one at a time), then assemble a finished recording. */
export async function transcribeDueParts(
  sb: Db,
  opts: { limit?: number; deadlineMs?: number } = {},
) {
  const started = Date.now();
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { skipped: "no_openai_key" };
  const staleAt = new Date(Date.now() - STALE_MS).toISOString();
  const { data: rows } = await sb
    .from("coaching_session_audio")
    .select("*")
    .or(`status.eq.uploaded,and(status.eq.transcribing,locked_at.lt.${staleAt})`)
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at")
    .limit(8);
  const done: Array<{ id: string; status: string }> = [];
  const touched = new Set<string>();
  for (const r of (rows ?? []) as any[]) {
    if (done.length >= (opts.limit ?? 2) || Date.now() - started > (opts.deadlineMs ?? 60_000))
      break;
    const { data: claimed } = await sb
      .from("coaching_session_audio")
      .update({
        status: "transcribing",
        locked_at: new Date().toISOString(),
        attempts: (r.attempts ?? 0) + 1,
      })
      .eq("id", r.id)
      .eq("updated_at", r.updated_at)
      .select("*");
    const part = claimed?.[0];
    if (!part) continue;
    done.push({ id: part.id, status: await transcribePart(sb, key, part) });
    touched.add(part.session_id);
  }
  // a part already transcribed when the recording finished: assemble now
  const { data: finishing } = await sb
    .from("coaching_sessions")
    .select("id")
    .contains("recording", { status: "processing" })
    .limit(5);
  for (const f of (finishing ?? []) as any[]) touched.add(f.id);
  const assembled: string[] = [];
  for (const id of touched) if (await assembleIfComplete(sb, id)) assembled.push(id);
  return { parts: done, assembled };
}

async function transcribePart(sb: Db, key: string, part: any): Promise<string> {
  const t0 = Date.now();
  const { recordAiCall } = await import("@/lib/ai/ai-health.server");
  try {
    const { clientAllowsAi } = await import("@/lib/ai-consent/consent.server");
    const consent = await clientAllowsAi(part.client_id);
    if (!consent.ok) {
      const { coachConsentMessage } = await import("@/lib/ai-consent/consent");
      await sb
        .from("coaching_session_audio")
        .update({
          status: "waiting_consent",
          error: coachConsentMessage(consent.name),
          locked_at: null,
          attempts: 0,
        })
        .eq("id", part.id);
      return "waiting_consent";
    }
    const { assertProviderUp } = await import("@/lib/ai/ai-health.server");
    await assertProviderUp("openai" as any);
    const { data: file, error } = await sb.storage.from(BUCKET).download(part.path);
    if (error || !file)
      throw new Error(`The recording part couldn't be read: ${error?.message ?? "missing"}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > 25 * 1024 * 1024) throw new Error("This part is too large to transcribe");
    const { data: s } = await sb
      .from("coaching_sessions")
      .select("recording")
      .eq("id", part.session_id)
      .maybeSingle();
    const refs = part.seq > 0 ? await speakerRefs(sb, (s as any)?.recording) : [];
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 110_000);
    let out: { segments: Segment[]; model: string };
    try {
      out = await transcribe(key, bytes, part.mime || "audio/webm", refs, ctl.signal);
    } finally {
      clearTimeout(timer);
    }
    const consistent = refs.length > 0 && out.model === DIARIZE_MODEL;
    await sb
      .from("coaching_session_audio")
      .update({
        status: "done",
        transcript: { segments: out.segments, consistent },
        model: out.model,
        error: null,
        locked_at: null,
      })
      .eq("id", part.id);
    void recordAiCall({
      model: `openai:${out.model}`,
      task: "session_transcribe",
      feature: "meeting_recording",
      ok: true,
      ms: Date.now() - t0,
    });
    return "done";
  } catch (e: any) {
    void recordAiCall({
      model: `openai:${DIARIZE_MODEL}`,
      task: "session_transcribe",
      feature: "meeting_recording",
      ok: false,
      error: e,
      ms: Date.now() - t0,
    });
    const { classifyAiError, isProviderFailure } = await import("@/lib/ai/ai-errors");
    if (isProviderFailure(classifyAiError(e))) {
      // AI is down or out of credits: the part waits, using no attempt
      await sb
        .from("coaching_session_audio")
        .update({
          status: "uploaded",
          locked_at: null,
          attempts: Math.max(0, (part.attempts ?? 1) - 1),
          error: `Waiting for AI: ${String(e?.message ?? e).slice(0, 200)}`,
        })
        .eq("id", part.id);
      return "waiting_ai";
    }
    const last = (part.attempts ?? 1) >= MAX_ATTEMPTS;
    await sb
      .from("coaching_session_audio")
      .update({
        status: last ? "failed" : "uploaded",
        locked_at: null,
        error: String(e?.message ?? e).slice(0, 300),
      })
      .eq("id", part.id);
    return last ? "failed" : "retry";
  }
}

/**
 * Every part of a finished recording is transcribed: the transcript is
 * written (with the speaker names the coach has confirmed, else "Speaker A"),
 * kept for the recording's retention, and Cleo reads it (analysis queued).
 */
export async function assembleIfComplete(
  sb: Db,
  sessionId: string,
  opts: { force?: boolean } = {},
): Promise<boolean> {
  const { data: s } = await sb
    .from("coaching_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  const rec = (s as any)?.recording;
  if (!s || !rec) return false;
  if (!opts.force && rec.status !== "processing") return false;
  const { data: parts } = await sb
    .from("coaching_session_audio")
    .select("seq, offset_ms, duration_ms, status, transcript")
    .eq("session_id", sessionId)
    .order("seq");
  const list = (parts ?? []) as any[];
  const expected = Number(rec.parts ?? list.length);
  if (list.length < expected || list.some((p) => p.status !== "done" && p.status !== "failed"))
    return false;
  const text = assembleTranscript(
    list as AudioPart[],
    (rec.speakers ?? {}) as SpeakerMap,
    rec.participants ?? [],
  );
  const path = `${(s as any).client_id}/${sessionId}.txt`;
  const now = new Date();
  const { error } = await sb.storage
    .from("coaching-transcripts")
    .upload(path, new Blob([text || "(no speech was recognised)"], { type: "text/plain" }), {
      upsert: true,
      contentType: "text/plain",
    });
  if (error) throw new Error(error.message);
  const days = Number(rec.retain_days ?? 30);
  const retain =
    days > 0 ? new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10) : null;
  const okToRead = text.replace(/\s+/g, " ").trim().length >= 40;
  const { cleoForUser } = await import("./sessions.server");
  const cleo = await cleoForUser(sb, (s as any).coach_user_id);
  await sb
    .from("coaching_sessions")
    .update({
      transcript_path: path,
      transcript_source: "other",
      transcript_consent_at: rec.consent?.at ?? now.toISOString(),
      transcript_retain_until: retain,
      transcript_deleted_at: null,
      recording: {
        ...rec,
        status: "ready",
        transcript_ready: true,
        assembled_at: now.toISOString(),
      },
      ...(okToRead && cleo && (s as any).analysis_status !== "running"
        ? { analysis_status: "queued", analysis_error: null, attempts: 0 }
        : {}),
      status: (s as any).status === "cancelled" ? "cancelled" : "done",
    })
    .eq("id", sessionId);
  await sb
    .from("coaching_session_events")
    .insert({
      session_id: sessionId,
      client_id: (s as any).client_id,
      actor: "system",
      action: "recording_transcribed",
      detail: { parts: list.length, queued_analysis: okToRead && cleo },
    });
  return true;
}

/** The recording's audio removed (the coach's delete, or its retention): files and rows. */
export async function deleteRecordingAudio(sb: Db, sessionId: string): Promise<number> {
  const { data: parts } = await sb
    .from("coaching_session_audio")
    .select("id, path")
    .eq("session_id", sessionId)
    .neq("status", "deleted");
  const paths = ((parts ?? []) as any[]).map((p) => p.path);
  const { data: s } = await sb
    .from("coaching_sessions")
    .select("recording, client_id")
    .eq("id", sessionId)
    .maybeSingle();
  const refs = (((s as any)?.recording?.speaker_refs ?? []) as any[])
    .map((r) => r.path)
    .filter(Boolean);
  if (paths.length || refs.length) await sb.storage.from(BUCKET).remove([...paths, ...refs]);
  if (paths.length)
    await sb
      .from("coaching_session_audio")
      .update({ status: "deleted", path: "" })
      .eq("session_id", sessionId)
      .neq("status", "deleted");
  if ((s as any)?.recording)
    await sb
      .from("coaching_sessions")
      .update({
        recording: {
          ...(s as any).recording,
          audio_deleted_at: new Date().toISOString(),
          speaker_refs: [],
        },
      })
      .eq("id", sessionId);
  return paths.length;
}
