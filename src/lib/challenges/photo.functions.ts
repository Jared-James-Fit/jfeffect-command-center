import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Challenge photos reach storage only through here. A photo needs a one-time
 * ticket (from registration with photo consent, a staff retake, or the
 * person's own claimed profile); the server checks the image itself, stores
 * it in the public challenge bucket under that person, and spends the ticket.
 */

const BUCKET = "challenge-media";
const MAX_BYTES = 2_500_000;

const UploadInput = z.object({
  token: z.string().regex(/^[a-f0-9]{48}$/),
  dataUrl: z.string().max(4_000_000),
});

function sniff(bytes: Uint8Array): { type: string; ext: string } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { type: "image/jpeg", ext: "jpg" };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return { type: "image/png", ext: "png" };
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return { type: "image/webp", ext: "webp" };
  return null;
}

function randomName(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabaseAdmin as any;
}

export const uploadChallengePhoto = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => UploadInput.parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: ticket, error: tErr } = await db.rpc("challenge_photo_ticket_check", {
      p_token: data.token,
    });
    if (tErr) throw new Error("The photo couldn't be checked. Try again.");
    if (!ticket?.person_id) throw new Error("That photo link has expired. Take the photo again.");

    const m = /^data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)$/.exec(data.dataUrl);
    if (!m) throw new Error("That photo couldn't be read.");
    const bytes = Uint8Array.from(Buffer.from(m[1]!, "base64"));
    if (bytes.byteLength < 1000) throw new Error("That photo is empty.");
    if (bytes.byteLength > MAX_BYTES) throw new Error("That photo is too big.");
    const kind = sniff(bytes);
    if (!kind) throw new Error("Only JPEG, PNG or WebP photos.");

    const path = `people/${ticket.person_id}/${randomName()}.${kind.ext}`;
    const { error: upErr } = await db.storage.from(BUCKET).upload(path, bytes, {
      contentType: kind.type,
      upsert: false,
      cacheControl: "31536000",
    });
    if (upErr) throw new Error("The photo didn't upload. Try again.");

    const { data: redeemed, error: rErr } = await db.rpc("challenge_photo_ticket_redeem", {
      p_token: data.token,
      p_path: path,
    });
    if (rErr) {
      await db.storage.from(BUCKET).remove([path]);
      throw new Error("That photo link has expired. Take the photo again.");
    }
    const old = (redeemed as { old_path?: string | null } | null)?.old_path;
    if (old && old !== path && old.startsWith(`people/${ticket.person_id}/`)) {
      await db.storage.from(BUCKET).remove([old]);
    }
    return { path };
  });

const RemoveInput = z.object({ personId: z.string().uuid() });

/** Take a person's photo down everywhere (them, or staff of an event they entered). */
export const removeChallengePhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RemoveInput.parse(d))
  .handler(async ({ data, context }) => {
    // the caller's own login decides whether they may (challenge_photo_clear checks)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: old, error } = await (context.supabase as any).rpc("challenge_photo_clear", {
      p_person: data.personId,
    });
    if (error) throw new Error(error.message || "You can't remove this photo.");
    if (typeof old === "string" && old.startsWith(`people/${data.personId}/`)) {
      const db = await admin();
      await db.storage.from(BUCKET).remove([old]);
    }
    return { ok: true };
  });
