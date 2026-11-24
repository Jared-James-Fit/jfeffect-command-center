import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { listPackageHistory, type AdminPackage } from "@/lib/coaching-packages/packages.functions";
import { changeWords } from "@/lib/coaching-packages/packages";

/** Every change to a package that a visitor or client could see, newest first (the pricing history). */
export function PackageHistorySheet({ pkg, onClose }: { pkg: AdminPackage | null; onClose: () => void }) {
  const list = useServerFn(listPackageHistory);
  const q = useQuery({
    queryKey: ["coaching-package-history", pkg?.id],
    enabled: !!pkg,
    queryFn: () => list({ data: { id: pkg!.id } }),
  });
  return (
    <Sheet open={!!pkg} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" data-package-history>
        <SheetHeader>
          <SheetTitle>{pkg?.name} · history</SheetTitle>
        </SheetHeader>
        {q.isLoading && <div className="mt-4 h-24 jf-skeleton rounded-xl bg-muted" />}
        {q.error && <p className="mt-4 text-[14px] text-destructive">{(q.error as Error).message}</p>}
        <ol className="mt-4 space-y-4">
          {(q.data ?? []).map((v) => (
            <li key={v.id} className="border-l-2 border-border pl-3">
              <p className="text-[13px] text-muted-foreground">
                {new Date(v.changed_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
                {v.changed_by_name ? ` · ${v.changed_by_name}` : ""}
                {v.live_after ? " · on the site" : ""}
              </p>
              <ul className="mt-1 text-[14px]">
                {changeWords(v.before, v.after).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </li>
          ))}
          {q.data && !q.data.length && <p className="text-[14px] text-muted-foreground">No changes yet.</p>}
        </ol>
      </SheetContent>
    </Sheet>
  );
}
