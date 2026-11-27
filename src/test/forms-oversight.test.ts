import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {formPurpose,formDeliveryLabel,formDeliveryMatches} from "@/lib/form-library";
const read=(p:string)=>readFileSync(p,"utf8");
describe("Forms oversight",()=>{
  it("uses protected setup types and configured delivery, not titles or new assignments",()=>{
    expect(formPurpose({form_type:"setup_goals"})).toBe("core");
    expect(formPurpose({form_type:"setup_competition"})).toBe("service");
    expect(formPurpose({form_type:"check_in"})).toBe("other");
    expect(formDeliveryLabel({form_type:"setup_goals"})).toBe("Account setup");
    expect(formDeliveryLabel({recurrence:"weekly"})).toContain("weekly");
    expect(formDeliveryLabel({auto_assign_new_clients:true})).toContain("Auto-share");
    expect(formDeliveryLabel({visibility:"all_active_clients"})).toBe("Available to active clients");
    expect(formDeliveryMatches({recurrence:"none"},"automatic")).toBe(false);
    expect(formDeliveryMatches({recurrence:"weekly"},"automatic")).toBe(true);
    expect(formDeliveryMatches({form_type:"setup_goals"},"manual")).toBe(false);
  });
  it("reads canonical obligations only after staff authorization and never writes",()=>{
    const source=read("src/lib/staff-form-requirements.functions.ts")+read("src/lib/staff-form-requirements.server.ts");
    expect(source).toContain("is_assigned_coach_for_client");
    expect(source).toContain("accountSetupRequirements");
    expect(source).toContain("isGoalsSetupComplete");
    expect(source).toContain("loadHandlingSetup");
    expect(source).toContain("isMemberAppAcceptance");
    expect(source).toContain("resolveAgreementState");
    expect(read("src/lib/cleo-tools.server.ts")).toContain("readStaffFormRequirements");
    expect(source).toContain('eq("user_id",target.user_id)');
    expect(source).not.toMatch(/\.insert\(|\.upsert\(|\.update\(|\.delete\(/);
  });
  it("keeps existing response viewers and profile form management",()=>{
    const library=read("src/route-pages/_authenticated/admin/native-forms.tsx");
    const profile=read("src/components/forms/client-forms-overview.tsx");
    expect(library).toContain("useFormLibraryStats");
    expect(library).toContain("RequirementCount");
    expect(library).toContain("historicalAgreements");
    expect(profile).toContain("AccountFormRequirements");
    expect(profile).toContain("FormResponsesSheet");
    expect(profile).toContain("FormPickerSheet");
    expect(profile).toContain("Completed submissions");
  });
});
