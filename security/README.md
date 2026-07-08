# Security Gate

A repeatable pre-publish gate that fails the build when the Lovable
security scanner reports RLS-related critical findings that are not
resolved **or** explicitly waived with an audit note.

## Files

- `security/findings.json` — snapshot of critical findings from the last
  scanner run. Update it whenever the scanner surfaces or clears an RLS
  critical (`level: "error"` from `supabase` / `supabase_lov` scanners).
  Each entry must include:
  ```json
  {
    "internal_id": "app_members_self_update_billing_fields",
    "scanner_name": "supabase_lov",
    "name": "Members can grant themselves paid access …",
    "level": "error",
    "first_seen": "2026-07-08T02:30:43Z"
  }
  ```
- `security/waivers.json` — audit-noted waivers. Each waiver must include
  the exact `internal_id`, a human `reason` (>= 40 chars), `waived_by`
  (name/handle), `waived_at` (ISO8601), and `expires_at` (ISO8601, must
  be in the future). Example:
  ```json
  {
    "internal_id": "messages_client_update_read_marker_too_broad",
    "scanner_name": "supabase_lov",
    "reason": "Column-level UPDATE grant plan approved; interim risk accepted because …",
    "waived_by": "jared@jfeffect.com",
    "waived_at": "2026-07-08T03:30:00Z",
    "expires_at": "2026-08-08T00:00:00Z"
  }
  ```

## The gate

`scripts/security-gate.mjs` compares the two files and exits non-zero when
any critical finding lacks a valid, unexpired waiver. It is invoked in two
places:

1. Automated: `src/test/security-gate.test.ts` runs it as part of the
   normal test suite (`bunx vitest run`). A failing gate fails CI, which
   fails the publish pipeline.
2. Manual: `bun run security:gate` for spot checks before publishing.

## Workflow when the scanner surfaces a new critical finding

1. Run the Lovable security scan (agent tool `security--run_security_scan`
   or product UI).
2. Add every new `level: "error"` finding to
   `security/findings.json → critical_findings`.
3. Either **fix** the finding (migration/policy change, then remove the
   entry from `findings.json` after re-scan) **or** add a waiver row to
   `security/waivers.json` with a full audit note and expiry.
4. Re-run `bun run security:gate` locally — it must exit 0 before the
   change may be published.

Waivers without a reason ≥ 40 characters, without a `waived_by`, or with
a missing/past `expires_at` are rejected by the gate.