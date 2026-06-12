import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useLocation } from "@tanstack/react-router";
import { getMySetupStatus } from "@/lib/member-setup.functions";
import { MemberSetupWizard } from "./member-setup-wizard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

const ALLOW = ["/m/billing", "/m/account", "/m/welcome", "/m/support"];

export function MemberSetupGate() {
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
  const needsSetup = !!member && isJfMember && !isSandbox && data?.complete === false;
  const isAllowed = ALLOW.some((p) => location.pathname.startsWith(p));

  useEffect(() => {
    if (needsSetup && !isAllowed) setOpen(true);
  }, [needsSetup, isAllowed]);

  if (!needsSetup) return null;

  return (
    <>
      {!isAllowed && (
        <div className="px-4 pt-4 md:px-6 md:pt-6">
          <Card className="border-amber-500/40 bg-amber-500/10 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 text-amber-500" />
                <div>
                  <div className="font-semibold">Finish your membership setup</div>
                  <div className="text-sm text-muted-foreground">
                    A few quick details unlock your full membership: profile photo, phone, basic info, and your goals.
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