import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const Input = z.object({
  messageId: z.string().uuid(),
  storagePath: z.string().min(1),
  mime: z.string().optional(),
});

export const transcribeVoiceMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    // Verify caller can access this message (RLS-scoped client)
    const { data: msg, error: mErr } = await supabase
      .from("messages")
      .select("id, client_id")
      .eq("id", data.messageId)
      .maybeSingle();
    if (mErr || !msg) throw new Error("Message not found or access denied");

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      await supabaseAdmin.from("messages").update({ transcript_status: "failed" }).eq("id", data.messageId);
      throw new Error("Missing LOVABLE_API_KEY");
    }

    // mark processing
    await supabaseAdmin.from("messages").update({ transcript_status: "processing" }).eq("id", data.messageId);

    try {
      // Download audio with admin client
      const { data: blob, error: dErr } = await supabaseAdmin.storage
        .from("message-attachments")
        .download(data.storagePath);
      if (dErr || !blob) throw new Error(dErr?.message ?? "Download failed");
      const buf = new Uint8Array(await blob.arrayBuffer());
      // base64 encode
      let bin = "";
      const chunk = 0x8000;
      for (let i = 0; i < buf.length; i += chunk) {
        bin += String.fromCharCode(...buf.subarray(i, i + chunk));
      }
      const b64 = btoa(bin);
      const mime = data.mime || blob.type || "audio/webm";
      const format = mime.includes("mp4") || mime.includes("m4a") ? "mp4"
        : mime.includes("wav") ? "wav"
        : mime.includes("mpeg") || mime.includes("mp3") ? "mp3"
        : "webm";

      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: "You transcribe short voice messages from a fitness coaching app. Return only the spoken text, no commentary. If the audio is silent or unintelligible, return an empty string.",
            },
            {
              role: "user",
              content: [
                { type: "text", text: "Transcribe this voice message." },
                { type: "input_audio", input_audio: { data: b64, format } },
              ],
            },
          ],
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error("Transcription gateway error", res.status, errText);
        await supabaseAdmin.from("messages").update({ transcript_status: "failed" }).eq("id", data.messageId);
        return { ok: false as const, status: res.status };
      }
      const json = await res.json();
      const text: string = json?.choices?.[0]?.message?.content?.trim?.() ?? "";
      await supabaseAdmin
        .from("messages")
        .update({ transcript: text || null, transcript_status: text ? "ready" : "empty" })
        .eq("id", data.messageId);
      return { ok: true as const, transcript: text };
    } catch (e: any) {
      console.error("Transcription failed", e);
      await supabaseAdmin.from("messages").update({ transcript_status: "failed" }).eq("id", data.messageId);
      return { ok: false as const, error: e?.message ?? "failed" };
    }
  });