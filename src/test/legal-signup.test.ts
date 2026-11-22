import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { recordSignupAcceptances } from "@/lib/legal-signup.server";
import { SIGNUP_ACK_TEXT } from "@/lib/legal-signup";

/** A tiny stand-in for the service-role client: just the reads and the insert this uses. */
function fakeDb(opts: {
  docs: Array<{ id: string; slug: string; archived?: boolean; current_version_id: string | null }>;
  versions: Array<{ id: string; status: string; needs_legal_review?: boolean; body: string }>;
  duplicate?: boolean;
}) {
  const inserted: any[] = [];
  const db = {
    inserted,
    from(table: string) {
      const q: any = {
        _filters: {} as Record<string, any>,
        select() {
          return q;
        },
        in(_c: string, vals: string[]) {
          q._in = vals;
          return Promise.resolve({
            data: opts.docs.filter((d) => vals.includes(d.slug)),
            error: null,
          });
        },
        eq(col: string, v: any) {
          q._filters[col] = v;
          return q;
        },
        maybeSingle: async () => {
          if (table === "clients") return { data: { id: "client-1" }, error: null };
          if (table === "legal_document_versions")
            return { data: opts.versions.find((v) => v.id === q._filters.id) ?? null, error: null };
          return { data: null, error: null };
        },
        insert: async (row: any) => {
          if (opts.duplicate) return { error: { code: "23505", message: "duplicate" } };
          inserted.push({ table, row });
          return { error: null };
        },
      };
      return q;
    },
  };
  return db;
}

describe("recordSignupAcceptances", () => {
  it("records the published Terms and Privacy Policy as a ticked checkbox at sign-up", async () => {
    const db = fakeDb({
      docs: [
        { id: "d-terms", slug: "terms-of-service", current_version_id: "v-terms" },
        { id: "d-priv", slug: "privacy-policy", current_version_id: "v-priv" },
      ],
      versions: [
        { id: "v-terms", status: "published", body: "Terms text" },
        { id: "v-priv", status: "published", body: "Privacy text" },
      ],
    });
    const r = await recordSignupAcceptances(db, {
      userId: "u-1",
      contextRef: "membership_application:a-1",
    });
    expect(r).toEqual({ recorded: ["terms-of-service", "privacy-policy"], missing: [] });
    expect(db.inserted).toHaveLength(2);
    const row = db.inserted[0].row;
    expect(db.inserted[0].table).toBe("legal_acceptances");
    expect(row).toMatchObject({
      user_id: "u-1",
      client_id: "client-1",
      context: "signup",
      signature_method: "checkbox",
      checkbox_checked: true,
      acknowledgement_text: SIGNUP_ACK_TEXT,
      context_ref: "membership_application:a-1",
    });
  });

  it("never records a draft, a version waiting on legal review, or a missing document", async () => {
    const db = fakeDb({
      docs: [{ id: "d-terms", slug: "terms-of-service", current_version_id: "v-terms" }],
      versions: [{ id: "v-terms", status: "published", needs_legal_review: true, body: "x" }],
    });
    const r = await recordSignupAcceptances(db, { userId: "u-1" });
    expect(r).toEqual({ recorded: [], missing: ["terms-of-service", "privacy-policy"] });
    expect(db.inserted).toHaveLength(0);

    const draft = fakeDb({
      docs: [{ id: "d-priv", slug: "privacy-policy", current_version_id: "v-priv" }],
      versions: [{ id: "v-priv", status: "draft", body: "x" }],
    });
    expect((await recordSignupAcceptances(draft, { userId: "u-1" })).recorded).toEqual([]);
  });

  it("treats a retry as the same evidence, not an error", async () => {
    const db = fakeDb({
      docs: [{ id: "d-terms", slug: "terms-of-service", current_version_id: "v-terms" }],
      versions: [{ id: "v-terms", status: "published", body: "x" }],
      duplicate: true,
    });
    const r = await recordSignupAcceptances(db, { userId: "u-1" });
    expect(r.recorded).toEqual(["terms-of-service"]);
  });
});

describe("the sign-up screen", () => {
  const page = readFileSync("src/components/join/activate-page.tsx", "utf8");
  it("asks with an unticked box instead of a passive 'by joining you agree' line", () => {
    expect(page).not.toMatch(/By joining you agree/);
    expect(page).toMatch(/useState\(false\)/);
    expect(page).toMatch(/data-signup-agree/);
    expect(page).toMatch(/agreed \}/);
  });
  it("is refused on the server without the tick", () => {
    const fns = readFileSync("src/lib/membership-applications.functions.ts", "utf8");
    expect(fns).toMatch(/if \(data\.agreed !== true\)/);
    expect(fns).toMatch(/recordSignupAcceptances/);
  });
});
