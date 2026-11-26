import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useLocation } from "@tanstack/react-router";
import { getMySetupStatus } from "@/lib/member-setup.functions";
import { MemberSetupWizard } from "./member-setup-wizard";
import { isFreeAccount } from "@/lib/member-setup-steps";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

const ALLOW = ["/portal/membership", "/portal/account", "/portal/support", "/portal/upgrade", "/portal/plan", "/m/billing", "/m/account", "/m/welcome", "/m/support"];

export function MemberSetupGate({ autoPrompt = true }: { autoPrompt?: boolean } = {}) {
  const fetchStatus = useServerFn(getMySetupStatus);
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["m-setup-status"],
    queryFn: () => fetchStatus(),
    staleTime: 60_000,
  });

  const member = data?.member as any;
  const isJfMember = member?.account_type === "jf_member";
  const isSandbox = !!member?.is_admin_sandbox;
  const free = isFreeAccount(member);
  const needsSetup = !!member && isJfMember && !isSandbox && data?.complete === false;
  const isHome = location.pathname === "/portal" || location.pathname === "/portal/";
  const isAllowed = isHome || ALLOW.some((p) => location.pathname.startsWith(p));

  useEffect(() => {
    if (autoPrompt && needsSetup && !isAllowed) setOpen(true);
  }, [autoPrompt, needsSetup, isAllowed]);

  // Home has the universal setup checklist, including its existing member wizard.
  if (!needsSetup || isHome) return null;

  return (
    <>
      {!isAllowed && (
        <div className="px-4 pt-4 md:px-6 md:pt-6">
          <Card className="border-amber-500/40 bg-amber-500/10 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 text-amber-500" />
                <div>
                  <div className="font-semibold">{free ? "Set up your training" : "Finish your membership setup"}</div>
                  <div className="text-sm text-muted-foreground">
                    {free
                      ? "Two quick questions: your goal and the days you train."
                      : "A few quick details unlock your full membership: profile photo, phone, basic info, and your goals."}
                  </div>
                </div>
              </div>
              <Button onClick={() => setOpen(true)}>Complete setup</Button>
            </div>
          </Card>
        </div>
      )}
      <MemberSetupWizard open={open} onClose={() => setOpen(false)} />
    </>
  );
}