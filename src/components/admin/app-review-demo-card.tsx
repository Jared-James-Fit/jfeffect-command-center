import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Smartphone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ActionButton } from "@/components/action-button";
import { getAppReviewDemoStatus, prepareAppReviewDemoData, removeAppReviewDemoData } from "@/lib/app-review-demo.functions";

/**
 * Admin → Settings: synthetic training for the two App Review logins (docs/APP_STORE_LISTING.md,
 * "Reviewer demo accounts"). It never creates a login or sets a password: the two accounts are
 * made first and found by the emails in app_settings (`app_review_demo_accounts`).
 */
export function AppReviewDemoCard() {
  const qc = useQueryClient();
  const statusFn = useServerFn(getAppReviewDemoStatus);
  const prepareFn = useServerFn(prepareAppReviewDemoData);
  const removeFn = useServerFn(removeAppReviewDemoData);
  const { data } = useQuery({ queryKey: ["app-review-demo"], queryFn: () => statusFn(), staleTime: 30_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ["app-review-demo"] });

  const prepare = async () => {
    try {
      const r = await prepareFn();
      for (const x of r.results) (x.status === "refused" ? toast.error : toast.success)(x.message);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not prepare the demo data");
    } finally {
      refresh();
    }
  };
  const remove = async () => {
    try {
      const r = await removeFn();
      toast.success(`Removed: ${r.summary}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not remove the demo data");
    } finally {
      refresh();
    }
  };

  return (
    <Card className="space-y-3 p-5 md:col-span-2" data-app-review-demo>
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <Smartphone className="h-4 w-4 text-muted-foreground" /> App Review demo accounts
      </h3>
      <p className="text-xs text-muted-foreground">
        Adds made-up training to the two logins you created for Apple's reviewer: a program, a few logged workouts, a check-in and a cardio plan for the coaching client, and a library plan with logged workouts for the free member. Only those two accounts, only if they have no training of their own, and everything it adds is listed so Remove takes away exactly that. It never creates a login or sets a password.
      </p>
      <ul className="space-y-1 text-sm">
        {(data?.accounts ?? []).map((a) => (
          <li key={a.key} className="flex flex-col gap-0.5">
            <span>
              <span className="font-medium">{a.key === "client" ? "Coaching client" : "Free member"}</span> · {a.email}
            </span>
            <span className="text-xs text-muted-foreground">
              {a.found ? `${a.tier ?? "unknown plan"}${a.hasLogin ? "" : ", no login yet"}` : "No account with this email yet"} · {a.summary}
            </span>
            {a.note && a.summary === "nothing yet" && <span className="text-xs text-warning">{a.note}</span>}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 border-t border-border/50 pt-3">
        <ActionButton onClick={prepare} jobLabel="Preparing App Review demo data" className="font-semibold">Prepare App Review demo data</ActionButton>
        <ActionButton variant="outline" onClick={remove} jobLabel="Removing App Review demo data">Remove demo data</ActionButton>
      </div>
    </Card>
  );
}
