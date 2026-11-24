import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertCleo, cleoAllowedFor, CLEO_OFF_MESSAGE, isMissingFunction } from "@/lib/cleo-access.server";
import { summerSystemPrompt } from "@/lib/summer-context";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
const migration = readFileSync(resolve(__dirname, "../../supabase/migrations/20270505090000_cleo_access.sql"), "utf8");

/** A caller's own Supabase client, just enough for assertCleo. */
function fakeDb(allowed: boolean | null, roles: string[], rpcError: { code?: string; message: string } | string | null = null) {
  return {
    rpc: async (fn: string) => {
      expect(fn).toBe("cleo_allowed");
      if (rpcError) return { data: null, error: typeof rpcError === "string" ? { message: rpcError } : rpcError };
      return { data: allowed, error: null };
    },
    from: (table: string) => {
      expect(table).toBe("user_roles");
      return { select: () => ({ eq: async () => ({ data: roles.map((role) => ({ role })), error: null }) }) };
    },
  };
}

describe("Cleo access: the server asks the database first", () => {
  it("refuses anyone cleo_allowed() says no to (clients, members, a switched-off coach)", async () => {
    await expect(assertCleo({ supabase: fakeDb(false, ["client"]), userId: "u" })).rejects.toThrow(CLEO_OFF_MESSAGE);
    await expect(assertCleo({ supabase: fakeDb(false, ["coach"]), userId: "u" })).rejects.toThrow(CLEO_OFF_MESSAGE);
    await expect(assertCleo({ supabase: fakeDb(null, ["admin"]), userId: "u" })).rejects.toThrow(CLEO_OFF_MESSAGE);
  });

  it("never lets a failed check through", async () => {
    await expect(assertCleo({ supabase: fakeDb(true, ["admin"], "boom"), userId: "u" })).rejects.toThrow(/Couldn't check Cleo access/);
  });

  it("the admin reads with their own login; a coach with theirs and never the books", async () => {
    const admin = fakeDb(true, ["admin"]);
    expect(await assertCleo({ supabase: admin, userId: "u" })).toEqual({ db: admin, viewOnly: false, coach: false });
    const coach = fakeDb(true, ["coach"]);
    expect(await assertCleo({ supabase: coach, userId: "u" })).toEqual({ db: coach, viewOnly: false, coach: true });
  });

  it("before the migration runs, keeps the rule from before: the admin and the finance login, never a coach", async () => {
    const missing = { code: "PGRST202", message: "Could not find the function public.cleo_allowed without parameters in the schema cache" };
    expect(isMissingFunction(missing)).toBe(true);
    expect(isMissingFunction({ message: "permission denied" })).toBe(false);
    const admin = fakeDb(null, ["admin"], missing);
    expect(await assertCleo({ supabase: admin, userId: "u" })).toEqual({ db: admin, viewOnly: false, coach: false });
    await expect(assertCleo({ supabase: fakeDb(null, ["coach"], missing), userId: "u" })).rejects.toThrow(CLEO_OFF_MESSAGE);
    await expect(assertCleo({ supabase: fakeDb(null, ["client"], missing), userId: "u" })).rejects.toThrow(CLEO_OFF_MESSAGE);
    expect(cleoAllowedFor(["finance"], null)).toBe(true);
    expect(cleoAllowedFor(["finance"], false)).toBe(false);
  });

  it("a role the database allowed that isn't staff is still refused", async () => {
    await expect(assertCleo({ supabase: fakeDb(true, ["client"]), userId: "u" })).rejects.toThrow(CLEO_OFF_MESSAGE);
  });
});

describe("Cleo access: one rule in the database", () => {
  it("defaults keep today's access: the finance login on, coaches off", () => {
    expect(migration).toContain(`VALUES ('cleo_access', '{"coach":false,"finance":true}')`);
    expect(migration).toContain("ON CONFLICT (key) DO NOTHING");
    expect(migration).toMatch(/'coach', coalesce\(\(j ->> 'coach'\)::boolean, false\)/);
    expect(migration).toMatch(/'finance', coalesce\(\(j ->> 'finance'\)::boolean, true\)/);
  });

  it("the admin always; finance and coaches by switch; everyone else never", () => {
    const fn = migration.slice(migration.indexOf("FUNCTION public.cleo_allowed()"), migration.indexOf("REVOKE ALL ON FUNCTION public.cleo_allowed()"));
    expect(fn).toContain("WHEN auth.uid() IS NULL THEN false");
    expect(fn).toMatch(/has_role\(auth\.uid\(\), 'admin'::public\.app_role\) THEN true/);
    expect(fn).toMatch(/is_admin_viewer\(\) THEN \(public\.cleo_access_settings\(\) ->> 'finance'\)/);
    expect(fn).toMatch(/'coach'::public\.app_role\) THEN \(public\.cleo_access_settings\(\) ->> 'coach'\)/);
    expect(fn).toContain("ELSE false");
  });

  it("only an admin reads or changes the switches", () => {
    for (const name of ["cleo_access_get", "cleo_access_set"]) {
      const body = migration.slice(migration.indexOf(`FUNCTION public.${name}(`));
      expect(body.slice(0, 600)).toMatch(/IF NOT public\.has_role\(auth\.uid\(\), 'admin'::public\.app_role\) THEN\s+RAISE EXCEPTION/);
    }
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.cleo_access_settings() FROM PUBLIC, anon, authenticated;");
  });

  it("a coach's own chats, settings and attachments follow the same rule", () => {
    for (const t of ["summer_messages", "summer_chats", "summer_profiles", "summer_attachments"]) {
      expect(migration).toMatch(new RegExp(`ON public\\.${t}\\s+FOR ALL TO authenticated\\s+USING \\(user_id = \\(SELECT auth\\.uid\\(\\)\\) AND \\(SELECT public\\.cleo_allowed\\(\\)\\)\\)`));
    }
    expect(migration.match(/bucket_id = 'cleo-attachments'[\s\S]*?cleo_allowed/g)?.length).toBe(3);
  });
});

describe("Cleo access: every Cleo server function checks it", () => {
  const fns = read("lib/business-books.functions.ts");
  const cleo = fns.slice(fns.indexOf("// Cleo\n"));

  it("uses assertCleo, never the old admin-or-finance check", () => {
    expect(cleo).not.toContain("assertAdminView");
    for (const name of ["getSummerMessages", "listSummerChats", "deleteSummerChat", "askSummer", "summerSpeech", "getSummerProfile", "saveSummerSettings"]) {
      const at = cleo.indexOf(`export const ${name} =`);
      expect(at, name).toBeGreaterThan(-1);
      const next = cleo.indexOf("export const ", at + 10);
      expect(cleo.slice(at, next === -1 ? undefined : next), name).toContain("await assertCleo(context");
    }
    expect(cleo).toMatch(/async function cleoActor\(context: any\) \{\s+const \{ db \} = await assertCleo\(context\);/);
  });

  it("a coach's Cleo reads no money and links only to a coach's pages", () => {
    const server = read("lib/summer.server.ts");
    expect(server).toContain('if (input.coach && !owner) return { owner, finance: false, section: "" };');
    expect(server).toContain('summerLinkCatalog(input.coach ? "coach" : "admin")');
    const prompt = summerSystemPrompt({ owner: false, coach: true, ownerName: "Jared", userName: "Fionna" });
    expect(prompt).toContain("Fionna, a coach on Jared's team");
    expect(prompt).toContain("PRIVATE: money is not theirs.");
    expect(prompt).not.toContain("You know their books (BOOKS)");
  });
});

describe("Cleo access: the screens follow it", () => {
  it("every way in waits for useCleoAccess", () => {
    expect(read("routes/_authenticated/admin/route.tsx")).toContain("{cleoOn && <SummerAssistant />}");
    const inbox = read("route-pages/_authenticated/admin/messages.tsx");
    expect(inbox).toContain("{cleoOn && !search && (");
    expect(inbox).not.toContain('role === "admin" && !search && (\n            // Cleo');
    expect(read("components/admin/finance/finance-home.tsx")).toMatch(/\{cleoOn && <QuickAction icon=\{MessageCircle\} label=\{`Ask \$\{ASSISTANT_NAME\}`\}/);
    expect(read("components/admin/money/money-workspace.tsx")).toContain("{cleoOn && (");
    expect(read("components/admin/money/books-pieces.tsx")).toContain("{cleoOn && <SummerSettingsCard");
    expect(read("components/keyboard-shortcuts.tsx")).toContain("i.label !== CLEO_SHORTCUT");
  });

  it("the admin page has the switches, for admins only", () => {
    const page = read("routes/_authenticated/admin/settings_.ai.tsx");
    expect(page).toContain("<CleoAccessCard />");
    expect(page).toContain('if (accountRole !== "admin")');
    expect(page).toContain("Clients and members: no Cleo.");
  });

  it("Cleo says what it is, with a face of its own (no sparkle, gradient or glow)", () => {
    const chat = read("components/cleo/cleo-panel.tsx");
    expect(chat).toContain("<CleoMark size={16} />");
    expect(chat).toContain("{CLEO_ROLE_LINE}");
    expect(chat).not.toMatch(/Sparkles|bg-gradient|from-amber-300|to-pink-500/);
    expect(read("components/summer/cleo-avatar.tsx")).toContain('export const CLEO_ROLE_LINE = "AI assistant";');
    expect(read("route-pages/_authenticated/admin/messages.tsx")).toContain("{CLEO_ROLE_LINE} · Ask anything, or tap the mic");
  });
});
