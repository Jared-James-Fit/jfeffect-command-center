import { createFileRoute } from "@tanstack/react-router";

/**
 * The server's bar-speed reader talks to the app here (scripts/velocity-worker,
 * run by GitHub Actions): claim the set videos waiting for a read (each with a
 * short-lived link to the file), say it's still reading, hand back the read,
 * or say why it couldn't; then the same for the athlete's body (pose_*: the
 * joints over the set, stored in pl_set_video_poses for Technique). Only this
 * repository's own workflow on GitHub's
 * runners gets in: its GitHub OIDC token, checked against GitHub's keys
 * (worker-oidc.ts). Every write goes through the velocity_worker_* functions,
 * which keep a person's own read and a speed typed in.
 */
const UUID = /^[0-9a-f-]{36}$/i;
/** A bar read with its packed track, or a body read (~100-400 KB packed for a set's window). */
const MAX_BODY = 3_500_000;
const LINK_SECONDS = 2 * 3600;

export const Route = createFileRoute("/api/public/hooks/velocity-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeWorker } = await import("@/lib/lift-analysis/worker-oidc.server");
        let auth: Awaited<ReturnType<typeof authorizeWorker>>;
        try {
          auth = await authorizeWorker(request);
        } catch {
          return Response.json({ error: "auth_unavailable" }, { status: 503 });
        }
        if (!auth.ok)
          return Response.json({ error: "unauthorized", why: auth.why }, { status: 401 });
        const text = await request.text();
        if (text.length > MAX_BODY) return Response.json({ error: "too_large" }, { status: 413 });
        let body: Record<string, any>;
        try {
          body = JSON.parse(text || "{}");
        } catch {
          return Response.json({ error: "bad_json" }, { status: 400 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as any;
        const video =
          typeof body.set_video_id === "string" && UUID.test(body.set_video_id)
            ? body.set_video_id
            : null;
        const lease =
          typeof body.lease_id === "string" && UUID.test(body.lease_id) ? body.lease_id : null;
        try {
          switch (body.action) {
            case "claim": {
              const max = Math.max(1, Math.min(5, Number(body.max) || 1));
              const worker = `gh:${auth.claims.run_id ?? ""}`;
              const { data, error } = await db.rpc("velocity_worker_claim", {
                _limit: max,
                _worker: worker,
              });
              if (error) throw error;
              const jobs = Array.isArray(data) ? data : [];
              const out = [];
              for (const j of jobs) {
                const { data: signed, error: signError } = await db.storage
                  .from("message-attachments")
                  .createSignedUrl(j.storage_path, LINK_SECONDS);
                if (signError || !signed?.signedUrl) {
                  await db.rpc("velocity_worker_fail", {
                    _video: j.set_video_id,
                    _lease: j.lease_id,
                    _reason: "The video file couldn't be found in storage.",
                    _retry: true,
                  });
                  continue;
                }
                out.push({ ...j, storage_path: undefined, url: signed.signedUrl });
              }
              return Response.json({ jobs: out });
            }
            case "heartbeat": {
              if (!video || !lease) return Response.json({ error: "bad_request" }, { status: 400 });
              const { data, error } = await db.rpc("velocity_worker_heartbeat", {
                _video: video,
                _lease: lease,
                _stage: String(body.stage ?? "").slice(0, 40),
              });
              if (error) throw error;
              return Response.json({ ok: !!data });
            }
            case "commit": {
              const result = body.result;
              if (
                !video ||
                !lease ||
                !result ||
                typeof result !== "object" ||
                Array.isArray(result)
              )
                return Response.json({ error: "bad_request" }, { status: 400 });
              if (!["done", "needs_tap", "failed"].includes(String(result.status ?? "done")))
                return Response.json({ error: "bad_result" }, { status: 400 });
              const { data, error } = await db.rpc("velocity_worker_commit", {
                _video: video,
                _lease: lease,
                _result: result,
                _compute_ms: Math.round(Number(body.compute_ms) || 0),
                _outcome: String(body.outcome ?? "").slice(0, 60) || null,
                _message: String(body.message ?? "").slice(0, 240) || null,
              });
              if (error) throw error;
              return Response.json(data ?? { ok: false });
            }
            case "fail": {
              if (!video || !lease) return Response.json({ error: "bad_request" }, { status: 400 });
              const { error } = await db.rpc("velocity_worker_fail", {
                _video: video,
                _lease: lease,
                _reason: String(body.reason ?? "The read couldn't finish.").slice(0, 240),
                _retry: body.retry !== false,
              });
              if (error) throw error;
              return Response.json({ ok: true });
            }
            case "pose_claim": {
              const max = Math.max(1, Math.min(5, Number(body.max) || 1));
              const worker = `gh:${auth.claims.run_id ?? ""}`;
              const { data, error } = await db.rpc("pose_worker_claim", {
                _limit: max,
                _worker: worker,
              });
              if (error) throw error;
              const jobs = Array.isArray(data) ? data : [];
              const out = [];
              for (const j of jobs) {
                const { data: signed, error: signError } = await db.storage
                  .from("message-attachments")
                  .createSignedUrl(j.storage_path, LINK_SECONDS);
                if (signError || !signed?.signedUrl) {
                  await db.rpc("pose_worker_fail", {
                    _video: j.set_video_id,
                    _lease: j.lease_id,
                    _reason: "The video file couldn't be found in storage.",
                    _retry: true,
                  });
                  continue;
                }
                out.push({ ...j, storage_path: undefined, url: signed.signedUrl });
              }
              return Response.json({ jobs: out });
            }
            case "pose_heartbeat": {
              if (!video || !lease) return Response.json({ error: "bad_request" }, { status: 400 });
              const { data, error } = await db.rpc("pose_worker_heartbeat", {
                _video: video,
                _lease: lease,
              });
              if (error) throw error;
              return Response.json({ ok: !!data });
            }
            case "pose_commit": {
              const pose = body.pose;
              if (!video || !lease || !pose || typeof pose !== "object" || Array.isArray(pose))
                return Response.json({ error: "bad_request" }, { status: 400 });
              if (!["done", "no_body"].includes(String(pose.status ?? "")))
                return Response.json({ error: "bad_result" }, { status: 400 });
              const { data, error } = await db.rpc("pose_worker_commit", {
                _video: video,
                _lease: lease,
                _pose: pose,
              });
              if (error) throw error;
              return Response.json(data ?? { ok: false });
            }
            case "pose_fail": {
              if (!video || !lease) return Response.json({ error: "bad_request" }, { status: 400 });
              const { error } = await db.rpc("pose_worker_fail", {
                _video: video,
                _lease: lease,
                _reason: String(body.reason ?? "The body read couldn't finish.").slice(0, 240),
                _retry: body.retry !== false,
              });
              if (error) throw error;
              return Response.json({ ok: true });
            }
            default:
              return Response.json({ error: "unknown_action" }, { status: 400 });
          }
        } catch (e: any) {
          return Response.json(
            { error: "server", message: String(e?.message ?? e).slice(0, 200) },
            { status: 500 },
          );
        }
      },
    },
  },
});
