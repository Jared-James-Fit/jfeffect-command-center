/**
 * Film notes: marks on one moment of a set video (lift_video_notes), drawn
 * over the original and never into it. A shape is in shares of the frame, or
 * a joint on the athlete's body that follows the joint as the clip plays.
 * Saved through the database's own functions (who may write, the set video's
 * client), sent to the coach chat as the annotated frame with the comment,
 * and opened from there on that exact frame.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- lift_video_notes isn't in the generated types yet
const db = supabase as any;

export type ShapeKind = "line" | "arrow" | "circle";
export type Shape =
  | { kind: ShapeKind; a: [number, number]; b: [number, number] }
  | { kind: "joint"; j: number };

export type FilmNote = {
  id: string;
  set_video_id: string;
  client_id: string;
  author_id: string;
  t: number;
  shapes: Shape[];
  body: string;
  layers: Record<string, boolean>;
  message_id: string | null;
  hidden_at: string | null;
  created_at: string;
  updated_at: string;
};

/** A note shows on the video this long either side of its moment (s), and always while it's picked. */
export const NOTE_SHOW_S = 0.4;

export const noteShownAt = (n: { t: number }, now: number) => Math.abs(n.t - now) <= NOTE_SHOW_S;

/** "0:04.2" */
export function noteClock(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

/** Keep only what the database takes (and a shape the finger actually drew). */
export function cleanShapes(shapes: Shape[]): Shape[] {
  const ok = (p: [number, number]) =>
    Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) < 4 && Math.abs(p[1]) < 4;
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  return shapes
    .filter((s) =>
      s.kind === "joint"
        ? Number.isInteger(s.j) && s.j >= 0 && s.j < 33
        : ok(s.a) && ok(s.b) && Math.hypot(s.a[0] - s.b[0], s.a[1] - s.b[1]) > 0.004,
    )
    .slice(0, 40)
    .map((s) =>
      s.kind === "joint"
        ? s
        : { kind: s.kind, a: [r4(s.a[0]), r4(s.a[1])], b: [r4(s.b[0]), r4(s.b[1])] },
    ) as Shape[];
}

const KEY = (setVideoId: string) => ["lift-video-notes", setVideoId] as const;

export function useFilmNotes(setVideoId: string | null) {
  return useQuery({
    queryKey: KEY(setVideoId ?? ""),
    enabled: !!setVideoId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await db
        .from("lift_video_notes")
        .select("*")
        .eq("set_video_id", setVideoId)
        .order("t", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((n: FilmNote) => ({ ...n, t: Number(n.t) })) as FilmNote[];
    },
  });
}

export function useRefreshFilmNotes() {
  const qc = useQueryClient();
  return (setVideoId: string) => qc.invalidateQueries({ queryKey: KEY(setVideoId) });
}

export async function saveFilmNote(input: {
  id?: string | null;
  setVideoId: string;
  t: number;
  shapes: Shape[];
  body: string;
  layers?: Record<string, boolean>;
}): Promise<string> {
  const { data, error } = await db.rpc("lift_video_note_save", {
    _id: input.id ?? null,
    _set_video_id: input.setVideoId,
    _t: Math.max(0, Math.round(input.t * 1000) / 1000),
    _shapes: cleanShapes(input.shapes),
    _body: input.body.trim(),
    _layers: input.layers ?? {},
  });
  if (error) throw new Error(error.message || "That note couldn't be saved.");
  return data as string;
}

export async function hideFilmNote(id: string, hide: boolean) {
  const { error } = await db.rpc("lift_video_note_remove", { _id: id, _hide: hide });
  if (error) throw new Error(error.message || "That note couldn't be changed.");
}

export async function deleteFilmNote(id: string) {
  const { error } = await db.rpc("lift_video_note_remove", {
    _id: id,
    _delete: true,
  });
  if (error) throw new Error(error.message || "That note couldn't be removed.");
}

/** The set video's own file (for the chat card that opens it). */
export async function setVideoFiles(setVideoId: string): Promise<{
  clientId: string;
  path: string;
  poster: string | null;
  exercise: string | null;
  label: string;
} | null> {
  const { data } = await db
    .from("pl_set_videos")
    .select("client_id, storage_path, thumbnail_path, exercise_name, label")
    .eq("id", setVideoId)
    .maybeSingle();
  if (!data) return null;
  return {
    clientId: data.client_id,
    path: data.storage_path,
    poster: data.thumbnail_path ?? null,
    exercise: data.exercise_name ?? null,
    label: data.label ?? "",
  };
}

/** What a film note's chat attachment carries, beside its picture. */
export type FilmNoteRef = {
  note_id: string;
  set_video_id: string;
  t: number;
  exercise?: string;
  label?: string;
  video_path: string;
  poster_path?: string | null;
  layers?: Record<string, boolean>;
};

/**
 * Send a note to the client's coach chat: the frame with its marks as a
 * picture, the moment and the comment as the words, and what the card needs
 * to open the clip on that frame. Records the message on the note.
 */
export async function sendFilmNote(input: {
  note: { id: string; t: number; body: string; layers?: Record<string, boolean> };
  setVideoId: string;
  png: Blob;
  senderId: string;
  senderRole: "admin" | "client";
  exerciseName: string;
}): Promise<void> {
  const files = await setVideoFiles(input.setVideoId);
  if (!files) throw new Error("That video isn't on a set any more.");
  const [{ uploadChatAttachment }, { sendMessage }] = await Promise.all([
    import("@/components/chat-shared"),
    import("@/lib/messages"),
  ]);
  const file = new File(
    [input.png],
    `film-note-${noteClock(input.note.t).replace(/[:.]/g, "-")}.png`,
    {
      type: "image/png",
    },
  );
  const att = (await uploadChatAttachment(files.clientId, file)) as Record<string, unknown>;
  const ref: FilmNoteRef = {
    note_id: input.note.id,
    set_video_id: input.setVideoId,
    t: input.note.t,
    exercise: files.exercise ?? input.exerciseName,
    label: files.label || undefined,
    video_path: files.path,
    poster_path: files.poster,
    layers: input.note.layers,
  };
  const what = [files.exercise ?? input.exerciseName, files.label].filter(Boolean).join(" · ");
  const body = `${what ? `${what} at ` : "At "}${noteClock(input.note.t)}${input.note.body ? `: ${input.note.body}` : ""}`;
  const msg = await sendMessage({
    clientId: files.clientId,
    senderId: input.senderId,
    senderRole: input.senderRole,
    body,
    attachments: [{ ...(att as object), film_note: ref } as never],
    messageType: "Film Note",
  });
  const { error } = await db.rpc("lift_video_note_sent", {
    _id: input.note.id,
    _message_id: (msg as { id: string }).id,
  });
  if (error) console.warn("[film-notes] message not recorded on the note", error);
}
