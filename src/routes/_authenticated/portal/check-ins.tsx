import { useState, useEffect, useMemo } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePortalUserId } from "@/lib/client-impersonation";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClipboardCheck, MessageCircle, ChevronRight, ExternalLink } from "lucide-react";
import {
  listFormsForClient,
  listSubmissionsForClient,
  statusLabel,
  statusTone,
  type NfForm,
} from "@/lib/native-forms";

export const Route = createFileRoute("/_authenticated/portal/check-ins")({
  component: ClientCheckInsList,
});

function ClientCheckInsList() {
  const portalUserId = usePortalUserId();
  const navigate = useNavigate();

  const { data: client } = useQuery({
    queryKey: ["my-client", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, full_name").eq("user_id", portalUserId!).maybeSingle();
      return data;
    },
  });

  const { data: forms = [] } = useQuery({
    queryKey: ["nf-forms-for-client", client?.id],
    enabled: !!client?.id,
    queryFn: () => listFormsForClient(client!.id),
  });

  const { data: submissions = [] } = useQuery({
    queryKey: ["nf-submissions-for-client", client?.id],
    enabled: !!client?.id,
    queryFn: () => listSubmissionsForClient(client!.id),
  });

  const byForm = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const s of submissions) {
      const arr = map.get(s.form_id) ?? [];
      arr.push(s);
      map.set(s.form_id, arr);
    }
    return map;
  }, [submissions]);

  if (client === null) {
    return (
      <>
        <PageHeader title="Check-Ins" />
        <div className="p-6">
          <Card className="p-6 text-sm text-muted-foreground">
            Your coach hasn't finished setting up your profile yet.
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Check-Ins & Forms"
        subtitle="Submit your assigned forms and see Coach Jared's reply in messenger."
      />
      <div className="space-y-6 p-4 md:p-8">
        {forms.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">
            No forms assigned yet. Your coach will assign your weekly check-in here.
            <div className="mt-3">
              <Link to="/portal/messages">
                <Button variant="outline" size="sm">
                  <MessageCircle className="mr-2 h-4 w-4" /> Message Coach
                </Button>
              </Link>
            </div>
          </Card>
        ) : (
          forms.map((f) => {
            const subs = byForm.get(f.id) ?? [];
            const latest = subs[0];
            const status = (latest?.status ?? "not_started") as any;
            return (
              <Card key={f.id} className="border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10">
                      <ClipboardCheck className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="text-lg font-black">{f.title}</div>
                      {f.description && (
                        <p className="mt-1 text-sm text-muted-foreground">{f.description}</p>
                      )}
                      {f.recurrence !== "none" && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {f.recurrence === "weekly" ? "Weekly" : f.recurrence === "biweekly" ? "Bi-weekly" : "Monthly"}
                          {f.recurrence_day ? ` · due ${f.recurrence_day}` : ""}
                        </p>
                      )}
                    </div>
                  </div>
                  <Badge className={statusTone(status) + " border"}>{statusLabel(status)}</Badge>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {f.kind === "external" ? (
                    f.external_url ? (
                      <Button asChild className="bg-gradient-primary font-bold">
                        <a
                          href={f.external_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={() => {
                            // navigate in-app too so client can mark as submitted
                            navigate({ to: "/portal/check-ins/$formId", params: { formId: f.id } });
                          }}
                        >
                          {f.button_label || "Open Check-In Form"}
                          <ExternalLink className="ml-1 h-4 w-4" />
                        </a>
                      </Button>
                    ) : (
                      <Button disabled className="font-bold">
                        No link set — contact your coach
                      </Button>
                    )
                  ) : (
                    <Button
                      onClick={() =>
                        navigate({ to: "/portal/check-ins/$formId", params: { formId: f.id } })
                      }
                      className="bg-gradient-primary font-bold"
                    >
                      {status === "in_progress"
                        ? "Continue"
                        : status === "not_started"
                          ? "Start Check-In"
                          : "Open"}
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  )}
                </div>

                {subs.length > 0 && (
                  <div className="mt-5 border-t border-border pt-4">
                    <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">History</div>
                    <ul className="mt-2 divide-y divide-border">
                      {subs.slice(0, 8).map((s: any) => (
                        <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                          <div>
                            {s.period_start ? `Week of ${s.period_start}` : new Date(s.created_at).toLocaleDateString()}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className={statusTone(s.status) + " border"}>{statusLabel(s.status)}</Badge>
                            <Link
                              to="/portal/check-ins/$formId"
                              params={{ formId: f.id }}
                              search={{ submissionId: s.id } as any}
                              className="text-xs text-primary underline-offset-2 hover:underline"
                            >
                              View
                            </Link>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>
    </>
  );
}

export {};