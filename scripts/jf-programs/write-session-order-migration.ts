/**
 * Writes supabase/migrations/20270411091000_jf_session_order.sql (Nov 18 2026): the JF Effect
 * library sessions whose order changed in src/lib/jf-programs/programs.ts (accessory flow), applied
 * to the copies already installed (pl_templates) and published to members (member_plans), only
 * while each copy is still exactly what was installed. Generated, never hand-edited:
 * src/test/accessory-flow-library.test.ts checks it against the definitions.
 *
 *   npx tsx scripts/jf-programs/write-session-order-migration.ts
 */
import { writeFileSync } from "node:fs";
import { sessionOrderSql, SESSION_ORDER_MIGRATION } from "../../src/lib/jf-programs/session-order-sql";

writeFileSync(SESSION_ORDER_MIGRATION, sessionOrderSql());
console.log(`wrote ${SESSION_ORDER_MIGRATION}`);
