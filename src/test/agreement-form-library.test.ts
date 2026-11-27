import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (path: string) => readFileSync(path,"utf8");
describe("Agreement records in Forms", () => {
  it("reads original records under existing admin read permissions, without writes or a service-role client", () => {
    const source = read("src/lib/agreement-form-records.functions.ts");
    for (const table of ["legal_acceptances","coaching_agreement_signatures","agreements"]) expect(source).toContain('.from("'+table+'")');
    expect(source).toContain("assertAdminView(context");
    expect(source).toContain("rendered_snapshot");
    expect(source).not.toMatch(/supabaseAdmin|\.insert\(|\.upsert\(|\.update\(|\.delete\(/);
    expect(source).toContain(".range(a,b)");
    expect(source).toContain('r.revoked_at ? "Revoked"');
  });
  it("uses protected library rows and non-persisted admin query keys", () => {
    const library = read("src/route-pages/_authenticated/admin/native-forms.tsx");
    expect(library).toContain("agreementGroups.map(group => <AgreementFormRow");
    expect(library).toContain('filter === "cat:Agreements"');
    const row = read("src/components/forms/agreement-form-row.tsx");
    expect(row).toContain("admin-agreement-form-records");
    expect(row).toContain("admin-legal-form-evidence");
    expect(row).toContain('accountRole === "admin"');
    expect(row).toContain("AgreementRecordViewer");
  });
});
