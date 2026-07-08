#!/usr/bin/env node
// Security publish gate: fails when a critical RLS finding has no valid waiver.
// Invoked from src/test/security-gate.test.ts and `bun run security:gate`.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

/** @typedef {{ internal_id: string, scanner_name: string, name?: string, level: string, first_seen?: string }} Finding */
/** @typedef {{ internal_id: string, scanner_name?: string, reason: string, waived_by: string, waived_at: string, expires_at: string }} Waiver */

function loadJson(rel) {
  const p = resolve(root, rel);
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (err) {
    throw new Error(`security-gate: cannot read ${rel}: ${(err && err.message) || err}`);
  }
}

function validateWaiver(w, now) {
  const errors = [];
  if (!w.internal_id) errors.push("missing internal_id");
  if (!w.waived_by || String(w.waived_by).trim().length === 0) errors.push("missing waived_by");
  const reason = String(w.reason || "").trim();
  if (reason.length < 40) errors.push(`reason must be >= 40 chars (got ${reason.length})`);
  const waivedAt = Date.parse(w.waived_at);
  if (Number.isNaN(waivedAt)) errors.push("waived_at is not a valid ISO8601 timestamp");
  const expiresAt = Date.parse(w.expires_at);
  if (Number.isNaN(expiresAt)) errors.push("expires_at is not a valid ISO8601 timestamp");
  else if (expiresAt <= now) errors.push(`expires_at is in the past (${w.expires_at})`);
  return errors;
}

export function runSecurityGate({ now = Date.now() } = {}) {
  const findings = loadJson("security/findings.json");
  const waiversDoc = loadJson("security/waivers.json");
  const criticals = /** @type {Finding[]} */ (findings.critical_findings || []);
  const waivers = /** @type {Waiver[]} */ (waiversDoc.waivers || []);

  const waiverById = new Map();
  const waiverErrors = [];
  for (const w of waivers) {
    const errs = validateWaiver(w, now);
    if (errs.length > 0) {
      waiverErrors.push({ internal_id: w.internal_id || "(unknown)", errors: errs });
      continue;
    }
    waiverById.set(w.internal_id, w);
  }

  const unresolved = [];
  for (const f of criticals) {
    if (String(f.level).toLowerCase() !== "error" && String(f.level).toLowerCase() !== "critical") continue;
    if (!waiverById.has(f.internal_id)) {
      unresolved.push(f);
    }
  }

  const ok = unresolved.length === 0 && waiverErrors.length === 0;
  return { ok, unresolved, waiverErrors, criticalsChecked: criticals.length, waiversLoaded: waiverById.size };
}

function formatReport(result) {
  const lines = [];
  lines.push(`security-gate: ${result.criticalsChecked} critical finding(s) tracked, ${result.waiversLoaded} valid waiver(s)`);
  if (result.waiverErrors.length > 0) {
    lines.push("");
    lines.push("Invalid waivers:");
    for (const w of result.waiverErrors) {
      lines.push(`  - ${w.internal_id}: ${w.errors.join("; ")}`);
    }
  }
  if (result.unresolved.length > 0) {
    lines.push("");
    lines.push("Unresolved critical findings (fix or add a waiver in security/waivers.json):");
    for (const f of result.unresolved) {
      lines.push(`  - [${f.scanner_name}] ${f.internal_id}${f.name ? ` — ${f.name}` : ""}`);
    }
  }
  if (result.ok) lines.push("OK — publishing gate passed.");
  return lines.join("\n");
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runSecurityGate();
  console.log(formatReport(result));
  process.exit(result.ok ? 0 : 1);
}

export { formatReport };