import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getGuestSigningContext, submitGuestSignature } from "@/lib/native-agreements.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/sign/$token")({
  component: SignPage,
  head: () => ({ meta: [{ title: "Sign your agreement — JF Effect" }] }),
});

const INTENT = "I have read this agreement, I intend to be legally bound by it, and my typed name constitutes my electronic signature.";

function SignPage() {
  const { token } = useParams({ from: "/sign/$token" });
  const fetchCtx = useServerFn(getGuestSigningContext);
  const submitFn = useServerFn(submitGuestSignature);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["sign-ctx", token],
    queryFn: () => fetchCtx({ data: { token } }),
    retry: false,
  });

  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [done, setDone] = useState(false);

  const submit = useMutation({
    mutationFn: () => submitFn({ data: {
      token, typedLegalName: name, intentWording: INTENT,
      timezone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined,
    } }),
    onSuccess: () => { setDone(true); toast.success("Signature recorded"); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="max-w-2xl mx-auto p-6">Loading…</div>;
  if (error) return (
    <div className="max-w-2xl mx-auto p-6">
      <Card className="p-6">
        <h1 className="text-xl font-semibold mb-2">Cannot open this agreement</h1>
        <p className="text-sm text-muted-foreground">{(error as Error).message}</p>
      </Card>
    </div>
  );
  if (!data) return null;

  if (done) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <Card className="p-8 text-center space-y-3">
          <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto" />
          <h1 className="text-2xl font-semibold">Signed</h1>
          <p className="text-muted-foreground">Thank you. A copy will be sent to {data.signer?.email}.</p>
        </Card>
      </div>
    );
  }

  const pkg: any = data.package;
  const snap: any = data.snapshot;
  const jp = pkg.jurisdiction_profiles ?? {};

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
      <Card className="p-6 space-y-2">
        <div className="text-xs text-muted-foreground">{jp.legal_operator_name ?? "JF Effect"}</div>
        <h1 className="text-2xl font-semibold">{pkg.custom_title ?? "Service Agreement"}</h1>
        <div className="text-sm text-muted-foreground">For: <strong>{data.signer?.full_name}</strong></div>
        {pkg.contract_value_minor != null && (
          <div className="text-lg font-semibold mt-2">
            {new Intl.NumberFormat("en-CA", { style: "currency", currency: pkg.currency ?? "CAD" }).format(pkg.contract_value_minor / 100)}
          </div>
        )}
      </Card>

      <Card className="p-6 space-y-3">
        <h2 className="font-semibold">Service Order</h2>
        <pre className="text-xs bg-muted p-3 rounded whitespace-pre-wrap">{JSON.stringify(pkg.service_order ?? {}, null, 2)}</pre>
        <h2 className="font-semibold">Financial Terms</h2>
        <pre className="text-xs bg-muted p-3 rounded whitespace-pre-wrap">{JSON.stringify(pkg.financial_terms ?? {}, null, 2)}</pre>
        {jp.approved_cancellation_wording && (
          <>
            <h2 className="font-semibold">Cancellation</h2>
            <p className="text-sm">{jp.approved_cancellation_wording}</p>
          </>
        )}
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold">Sign</h2>
        <div className="flex items-start gap-2">
          <Checkbox id="agree" checked={agreed} onCheckedChange={(v) => setAgreed(!!v)} />
          <Label htmlFor="agree" className="text-sm leading-snug">{INTENT}</Label>
        </div>
        <div>
          <Label htmlFor="name">Type your full legal name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={data.signer?.full_name ?? ""} />
          <p className="text-xs text-muted-foreground mt-1">Must match exactly: <strong>{data.signer?.full_name}</strong></p>
        </div>
        <Button
          className="w-full"
          disabled={!agreed || !name.trim() || submit.isPending}
          onClick={() => submit.mutate()}
        >
          {submit.isPending ? "Recording…" : "Sign agreement"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Snapshot {snap.snapshot_hash.slice(0, 16)}… · Your timestamp will be recorded.
        </p>
      </Card>
    </div>
  );
}