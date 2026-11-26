import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import {
  endEnrollment,
  enrollClientInPackage,
  listClientSalesForPackage,
  listCoachingPackages,
  listEnrollments,
  type AdminPackage,
  type Enrollment,
} from "@/lib/coaching-packages/packages.functions";
import { priceLabel, toPublic } from "@/lib/coaching-packages/packages";
import { PackageCard } from "@/components/sales/coaching-packages";

export const enrollmentsKey = (o: { packageId?: string; clientId?: string }) => ["coaching-package-enrollments", o.packageId ?? null, o.clientId ?? null] as const;

function todayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Winnipeg" });
}

function dayLabel(iso: string | null): string {
  if (!iso) return "";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** One client's place on a package, in a line. */
function EnrollmentRow({ e, onEnd, showClient }: { e: Enrollment; onEnd?: () => void; showClient: boolean }) {
  return (
    <li className="flex items-start justify-between gap-3 py-3" data-enrollment={e.id}>
      <div className="min-w-0">
        <p className="text-[15px] font-medium">{showClient ? (e.client_name ?? "Client") : e.package_name}</p>
        <p className="text-[13px] text-muted-foreground">
          {[
            e.status === "active" ? `Since ${dayLabel(e.starts_on)}` : `${dayLabel(e.starts_on)} to ${dayLabel(e.ends_on)}`,
            e.contracted_price_cents != null ? `pays ${priceLabel(e.contracted_price_cents)} + tax` : null,
            e.included_calls != null ? `${e.included_calls} calls a month (their own)` : null,
            e.sale_name ? `billed by ${e.sale_name}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {e.note && <p className="mt-0.5 text-[13px] text-muted-foreground">{e.note}</p>}
      </div>
      {e.status === "active" && onEnd && (
        <Button size="sm" variant="ghost" onClick={onEnd}>
          End
        </Button>
      )}
    </li>
  );
}

/**
 * Putting a client on a package. Nothing here charges anyone or changes a
 * subscription: what they pay stays their sale's; "what they pay" is only
 * noted for a grandfathered or custom price.
 */
export function EnrollForm({
  clientId,
  packageId,
  onDone,
}: {
  clientId?: string;
  packageId?: string;
  onDone: () => void;
}) {
  const enroll = useServerFn(enrollClientInPackage);
  const listPkgs = useServerFn(listCoachingPackages);
  const listSales = useServerFn(listClientSalesForPackage);
  const [client, setClient] = useState<{ id: string; name: string } | null>(clientId ? { id: clientId, name: "" } : null);
  const [search, setSearch] = useState("");
  const [pkgId, setPkgId] = useState(packageId ?? "");
  const [startsOn, setStartsOn] = useState(todayISO());
  const [saleId, setSaleId] = useState("");
  const [price, setPrice] = useState("");
  const [calls, setCalls] = useState("");
  const [note, setNote] = useState("");

  const pkgs = useQuery({ queryKey: ["coaching-packages-admin"], queryFn: () => listPkgs(), enabled: !packageId });
  const people = useQuery({
    queryKey: ["enroll-client-search", search],
    enabled: !clientId && search.trim().length >= 2,
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, full_name")
        .ilike("full_name", `%${search.trim().replace(/[%_]/g, "")}%`)
        .eq("archived", false)
        .eq("service_tier", "coaching")
        .order("full_name")
        .limit(8);
      return (data ?? []) as { id: string; full_name: string | null }[];
    },
  });
  const sales = useQuery({
    queryKey: ["enroll-client-sales", client?.id],
    enabled: !!client?.id,
    queryFn: () => listSales({ data: { clientId: client!.id } }),
  });
  const chosen: AdminPackage | undefined = pkgs.data?.packages.find((p) => p.id === pkgId);
  const active = (pkgs.data?.packages ?? []).filter((p) => p.status === "active" && p.kind !== "free");

  const m = useMutation({
    mutationFn: () => {
      const cents = price.trim() ? Math.round(Number(price.replace(/[$,\s]/g, "")) * 100) : null;
      if (cents != null && !Number.isFinite(cents)) throw new Error("That price doesn't look right.");
      return enroll({
        data: {
          clientId: client!.id,
          packageId: pkgId,
          startsOn,
          saleId: saleId || null,
          contractedPriceCents: cents,
          includedCalls: calls.trim() ? Number(calls) : null,
          note: note || null,
        },
      });
    },
    onSuccess: () => {
      toast.success("Package set. Nothing was charged.");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4 rounded-xl bg-muted/50 p-4" data-enroll-form>
      {!clientId && (
        <div>
          <Label>Client</Label>
          {client ? (
            <div className="mt-1.5 flex items-center justify-between rounded-lg bg-background px-3 py-2">
              <span className="text-[15px]">{client.name}</span>
              <Button size="sm" variant="ghost" onClick={() => setClient(null)}>
                Change
              </Button>
            </div>
          ) : (
            <>
              <Input className="mt-1.5" placeholder="Search coaching clients" value={search} onChange={(e) => setSearch(e.target.value)} />
              <ul className="mt-1">
                {(people.data ?? []).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="w-full rounded-lg px-3 py-2 text-left text-[15px] hover:bg-background"
                      onClick={() => setClient({ id: c.id, name: c.full_name ?? "Client" })}
                    >
                      {c.full_name}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {!packageId && (
        <div>
          <Label>Package</Label>
          <select
            className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-[14px]"
            value={pkgId}
            onChange={(e) => setPkgId(e.target.value)}
          >
            <option value="">Pick a package</option>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.price_cents ? `${priceLabel(p.price_cents)}${p.kind === "subscription" ? "/month" : ""}` : "no price"}
                {p.is_public ? "" : " (not on the site)"}
              </option>
            ))}
          </select>
          {chosen && <div className="mt-3">
            <PackageCard pkg={toPublic(chosen)} preview compact />
            <p className="mt-2 text-xs text-muted-foreground">Catalogue inclusions and advertised price. Your client's actual agreed price and billing remain separate.</p>
          </div>}
          {!active.length && <p className="mt-1 text-[13px] text-muted-foreground">Only an active package can take clients.</p>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Starts</Label>
          <Input className="mt-1.5" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </div>
        <div>
          <Label>What they pay (optional)</Label>
          <Input className="mt-1.5" inputMode="decimal" placeholder="Same as their sale" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
      </div>
      {client && (
        <div>
          <Label>Billed by (optional)</Label>
          <select
            className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-[14px]"
            value={saleId}
            onChange={(e) => setSaleId(e.target.value)}
          >
            <option value="">No sale linked (calls run from the start date)</option>
            {(sales.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.nextBilling ? ` · next charge ${dayLabel(s.nextBilling)}` : ""}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[12px] text-muted-foreground">Their included calls run from this sale's billing date each month.</p>
        </div>
      )}
      {(chosen?.included_calls ?? 0) > 0 || packageId ? (
        <div>
          <Label>Calls a month (optional)</Label>
          <Input className="mt-1.5" inputMode="numeric" placeholder="The package's number" value={calls} onChange={(e) => setCalls(e.target.value.replace(/\D/g, ""))} />
        </div>
      ) : null}
      <div>
        <Label>Note (optional)</Label>
        <Input className="mt-1.5" maxLength={500} placeholder="e.g. Grandfathered at $99" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="flex justify-end">
        <Button onClick={() => m.mutate()} disabled={!client || !pkgId || m.isPending} data-enroll-save>
          {m.isPending ? "Saving…" : "Put them on it"}
        </Button>
      </div>
    </div>
  );
}

/** Who's on a package (toolkit → a package's ⋯ → Clients on it). */
export function EnrollmentsSheet({ pkg, onClose, onChanged }: { pkg: AdminPackage | null; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const list = useServerFn(listEnrollments);
  const end = useServerFn(endEnrollment);
  const [adding, setAdding] = useState(false);
  const key = enrollmentsKey({ packageId: pkg?.id });
  const q = useQuery({ queryKey: key, enabled: !!pkg, queryFn: () => list({ data: { packageId: pkg!.id } }) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["coaching-package-enrollments"] });
    onChanged();
  };
  const ending = useMutation({
    mutationFn: (id: string) => end({ data: { id } }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = q.data ?? [];
  return (
    <Sheet open={!!pkg} onOpenChange={(o) => !o && (setAdding(false), onClose())}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" data-enrollments>
        <SheetHeader>
          <SheetTitle>{pkg?.name} · clients</SheetTitle>
          <p className="text-[13px] text-muted-foreground">
            Who's on it and what they pay. Changing this never changes a sale or a subscription.
          </p>
        </SheetHeader>
        <div className="mt-4">
          {pkg?.status === "active" &&
            (adding ? (
              <EnrollForm
                packageId={pkg.id}
                onDone={() => {
                  setAdding(false);
                  refresh();
                }}
              />
            ) : (
              <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                Add a client
              </Button>
            ))}
          {pkg && pkg.status !== "active" && (
            <p className="text-[13px] text-muted-foreground">Set the package to Active to put clients on it.</p>
          )}
          <ul className="mt-3 divide-y divide-border">
            {rows.map((e) => (
              <EnrollmentRow key={e.id} e={e} showClient onEnd={() => ending.mutate(e.id)} />
            ))}
          </ul>
          {q.data && !rows.length && <p className="mt-3 text-[14px] text-muted-foreground">Nobody is on it yet.</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** A client's coaching package on their profile, with Change. */
export function ClientPackageCard({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listEnrollments);
  const end = useServerFn(endEnrollment);
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: enrollmentsKey({ clientId }), queryFn: () => list({ data: { clientId } }) });
  const current = (q.data ?? []).find((e) => e.status === "active") ?? null;
  const refresh = () => void qc.invalidateQueries({ queryKey: ["coaching-package-enrollments"] });
  const ending = useMutation({
    mutationFn: (id: string) => end({ data: { id } }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.isLoading) return null;
  return (
    <div className="rounded-2xl border border-border p-4" data-client-package>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[16px] font-semibold">Coaching package</p>
          {current ? (
            <ul>
              <EnrollmentRow e={current} showClient={false} onEnd={() => ending.mutate(current.id)} />
            </ul>
          ) : (
            <p className="text-[14px] text-muted-foreground">Not set. It decides things like included video calls.</p>
          )}
        </div>
        {!editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            {current ? "Change" : "Set"}
          </Button>
        )}
      </div>
      {editing && (
        <div className="mt-3">
          <EnrollForm
            clientId={clientId}
            onDone={() => {
              setEditing(false);
              refresh();
            }}
          />
          <Button className="mt-2" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
