import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MembershipLeaf } from "@/components/admin/membership-leaf";
import { DefaultAccessChecklist } from "@/components/admin/jf-default-access-checklist";

export const Route = createFileRoute("/_authenticated/admin/membership/access-checklist")({
  component: AccessChecklistPage,
});

function AccessChecklistPage() {
  const [overrides, setOverrides] = useState<Set<string>>(new Set());
  return (
    <MembershipLeaf title="Access Checklist" subtitle="Default features granted to JF Membership accounts on signup.">
      <DefaultAccessChecklist
        accountType="jf_member"
        overrides={overrides}
        onToggleOverride={(k) => setOverrides((prev) => {
          const next = new Set(prev);
          if (next.has(k)) next.delete(k); else next.add(k);
          return next;
        })}
      />
    </MembershipLeaf>
  );
}