import { createFileRoute } from "@tanstack/react-router";

/**
 * Attaches a proof (a screenshot or photo, base64 in the body) to one payment
 * recorded by hand that has none yet, for a proof that reached the business
 * outside the app. Called from the database with the vault's cron_hook_secret
 * (net.http_post), never from a browser; the app's own Record payment and
 * Attach proof upload with the admin's login instead. It never replaces a
 * proof, never touches a Stripe payment and never changes an amount.
 */
export const Route = createFileRoute("/api/public/hooks/payment-proof-import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        const body = await request.json().catch(() => ({}));
        const ledgerId = String(body?.ledger_id ?? "");
        const type = String(body?.content_type ?? "");
        const b64 = String(body?.data_base64 ?? "");
        const { proofPath, proofProblem } = await import("@/lib/payment-proof");
        const bytes = Buffer.from(b64, "base64");
        const problem = proofProblem({ type, size: bytes.length });
        if (!/^[0-9a-f-]{36}$/i.test(ledgerId) || !bytes.length || problem) {
          return Response.json({ error: problem ?? "ledger_id and the file are required" }, { status: 400 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin as any;
        const { data: row } = await admin.from("payment_ledger").select("id, client_id, source, proof_path, transaction_date").eq("id", ledgerId).maybeSingle();
        if (!row) return Response.json({ error: "payment not found" }, { status: 404 });
        if (row.source !== "manual") return Response.json({ error: "only a payment recorded by hand takes a proof" }, { status: 400 });
        if (row.proof_path) return Response.json({ ok: true, already: true, proof_path: row.proof_path });
        const { randomBytes } = await import("node:crypto");
        const path = proofPath(row.client_id, type, String(row.transaction_date ?? new Date().toISOString()).slice(0, 10), randomBytes(8).toString("hex"));
        const { error: upErr } = await admin.storage.from("payment-proofs").upload(path, bytes, { contentType: type, upsert: false });
        if (upErr) return Response.json({ error: upErr.message }, { status: 500 });
        const { error } = await admin.from("payment_ledger").update({ proof_path: path, proof_uploaded_at: new Date().toISOString() }).eq("id", row.id).is("proof_path", null);
        if (error) return Response.json({ error: error.message }, { status: 500 });
        await admin.from("financial_audit_events").insert({
          client_id: row.client_id, actor_user_id: null, actor_role: "system", action: "payment_proof_attached",
          record_type: "payment_ledger", record_id: row.id, after_state: { proof_path: path }, reason: "Proof sent to the business outside the app",
        });
        return Response.json({ ok: true, proof_path: path });
      },
    },
  },
});
