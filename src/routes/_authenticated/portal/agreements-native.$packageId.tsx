import { createFileRoute, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { CheckCircle2, ExternalLink, PenLine, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  acknowledgeClientNativeAgreementReview,
  getClientNativeAgreement,
  getClientNativeAgreementSourcePdfUrl,
  submitClientNativeAgreementSignature,
} from "@/lib/native-agreement-client.functions";

export const Route = createFileRoute("/_authenticated/portal/agreements-native/$packageId")({
  component: ClientNativeAgreementPage,
});

type SignatureMethod = "typed" | "drawn";

function SignaturePad({ onChange }: { onChange: (value: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.height / bounds.height),
    };
  };
  const finish = () => {
    if (!drawingRef.current || !canvasRef.current) return;
    drawingRef.current = false;
    const value = canvasRef.current.toDataURL("image/png");
    onChange(value);
  };
  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onChange("");
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={900}
        height={320}
        className="w-full touch-none rounded-lg border border-dashed border-border bg-background"
        aria-label="Draw your signature"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const canvas = canvasRef.current!;
          const ctx = canvas.getContext("2d")!;
          const p = point(event);
          ctx.lineWidth = 4;
          ctx.lineCap = "round";
          ctx.strokeStyle = "#111827";
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          drawingRef.current = true;
          setHasInk(true);
        }}
        onPointerMove={(event) => {
          if (!drawingRef.current) return;
          const ctx = canvasRef.current?.getContext("2d");
          if (!ctx) return;
          const p = point(event);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Draw your usual signature using your finger or stylus.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={clear} disabled={!hasInk}>
          Clear
        </Button>
      </div>
    </div>
  );
}

function ClientNativeAgreementPage() {
  const { packageId } = useParams({ from: "/_authenticated/portal/agreements-native/$packageId" });
  const getAgreement = useServerFn(getClientNativeAgreement);
  const acknowledge = useServerFn(acknowledgeClientNativeAgreementReview);
  const getSourcePdf = useServerFn(getClientNativeAgreementSourcePdfUrl);
  const submitSignature = useServerFn(submitClientNativeAgreementSignature);
  const [reviewed, setReviewed] = useState(false);
  const [method, setMethod] = useState<SignatureMethod>("typed");
  const [typedName, setTypedName] = useState("");
  const [drawnSignature, setDrawnSignature] = useState("");
  const [signed, setSigned] = useState(false);

  const query = useQuery({
    queryKey: ["portal-native-agreement", packageId],
    queryFn: () => getAgreement({ data: { packageId } }),
    retry: false,
  });
  const reviewMutation = useMutation({
    mutationFn: () => acknowledge({ data: { packageId } }),
    onSuccess: () => setReviewed(true),
  });
  const signatureMutation = useMutation({
    mutationFn: async () => {
      const context = query.data!;
      return submitSignature({
        data: {
          packageId,
          typedLegalName: typedName,
          intentWording: context.intentWording,
          signatureMethod: method,
          signatureRepresentation: method === "typed" ? typedName : drawnSignature,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
    },
    onSuccess: () => setSigned(true),
  });

  if (query.isLoading)
    return <div className="p-6 text-sm text-muted-foreground">Loading agreement…</div>;
  if (query.error || !query.data) {
    return (
      <div className="p-6">
        <Card className="p-5">
          <h1 className="font-semibold">Agreement unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {(query.error as Error)?.message ?? "This agreement could not be opened."}
          </p>
        </Card>
      </div>
    );
  }

  const { package: pkg, signer, snapshot, intentWording } = query.data as any;
  const canSign =
    reviewed &&
    typedName.trim() &&
    (method === "typed" || drawnSignature) &&
    !signatureMutation.isPending;

  if (signed) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <Card className="space-y-3 p-7 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
          <h1 className="text-2xl font-semibold">Agreement signed</h1>
          <p className="text-sm text-muted-foreground">
            Your signature is recorded against the immutable {snapshot.snapshot_hash.slice(0, 16)}…
            snapshot. Your signed PDF is now being prepared and will appear in Agreements when
            ready.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:p-6">
      <Card className="space-y-2 p-5">
        <p className="text-xs font-bold uppercase tracking-wider text-primary">
          Native agreement · v1.0
        </p>
        <h1 className="text-2xl font-semibold">
          {pkg.custom_title ?? "JF Effect Coaching Agreement"}
        </h1>
        <p className="text-sm text-muted-foreground">
          For {signer.full_name}. Review the exact agreement PDF before signing.
        </p>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">1. Review the agreement</h2>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={async () => {
            const result: any = await getSourcePdf({ data: { packageId } });
            window.open(result.url, "_blank", "noopener,noreferrer");
          }}
        >
          Open exact agreement PDF <ExternalLink className="ml-2 h-4 w-4" />
        </Button>
        <div className="flex items-start gap-3">
          <Checkbox
            id="native-review"
            checked={reviewed}
            onCheckedChange={async (value) => {
              if (!value) return setReviewed(false);
              await reviewMutation.mutateAsync();
            }}
          />
          <Label htmlFor="native-review" className="text-sm leading-snug">
            I have reviewed this agreement and understand that I will sign the exact version shown
            above.
          </Label>
        </div>
        {reviewMutation.error && (
          <p className="text-sm text-destructive">{(reviewMutation.error as Error).message}</p>
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">2. Sign</h2>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={method === "typed" ? "default" : "outline"}
            onClick={() => setMethod("typed")}
          >
            <Type className="mr-2 h-4 w-4" />
            Type signature
          </Button>
          <Button
            type="button"
            variant={method === "drawn" ? "default" : "outline"}
            onClick={() => setMethod("drawn")}
          >
            <PenLine className="mr-2 h-4 w-4" />
            Draw signature
          </Button>
        </div>
        <div>
          <Label htmlFor="native-legal-name">Full legal name</Label>
          <Input
            id="native-legal-name"
            value={typedName}
            onChange={(event) => setTypedName(event.target.value)}
            placeholder={signer.full_name}
            autoComplete="name"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Must match: <strong>{signer.full_name}</strong>
          </p>
        </div>
        {method === "drawn" && <SignaturePad onChange={setDrawnSignature} />}
        <p className="rounded-md bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
          {intentWording}
        </p>
        <Button className="w-full" disabled={!canSign} onClick={() => signatureMutation.mutate()}>
          {signatureMutation.isPending ? "Recording signature…" : "Sign agreement"}
        </Button>
        {signatureMutation.error && (
          <p className="text-sm text-destructive">{(signatureMutation.error as Error).message}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Snapshot {snapshot.snapshot_hash.slice(0, 16)}… · Signature time and authenticated account
          are recorded.
        </p>
      </Card>
    </main>
  );
}
