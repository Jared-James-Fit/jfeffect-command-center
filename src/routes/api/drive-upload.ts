import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

function json(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

function assertDriveUploadUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid Drive upload URL");
  }
  const isGoogleApi = url.hostname === "googleapis.com" || url.hostname.endsWith(".googleapis.com");
  if (url.protocol !== "https:" || !isGoogleApi || !url.pathname.startsWith("/upload/drive/v3/files")) {
    throw new Error("Invalid Drive upload target");
  }
  return url.toString();
}

async function requireUser(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Unauthorized");

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Auth is not configured");

  const supabase = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) throw new Error("Unauthorized");
}

export const Route = createFileRoute("/api/drive-upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireUser(request);

          const uploadUrl = assertDriveUploadUrl(request.headers.get("x-drive-upload-url") ?? "");
          const mimeType = request.headers.get("content-type") || "application/octet-stream";
          if (!request.body) {
            return json({ error: "Missing video file body" }, { status: 400 });
          }

          const upstream = await fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": mimeType },
            body: request.body,
          });
          const text = await upstream.text();
          if (!upstream.ok) {
            console.error("[drive-upload] upstream failed", upstream.status, text.slice(0, 500));
            return json({ error: `Drive upload failed: HTTP ${upstream.status}`, detail: text.slice(0, 500) }, { status: 502 });
          }

          return new Response(text || "{}", {
            status: 200,
            headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
          });
        } catch (error: any) {
          const message = error?.message ?? "Upload failed";
          const status = message === "Unauthorized" ? 401 : 500;
          console.error("[drive-upload] failed", message);
          return json({ error: message }, { status });
        }
      },
    },
  },
});