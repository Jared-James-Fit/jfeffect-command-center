import { useEffect, useMemo, useRef, useState } from "react";
import SignaturePad from "react-signature-canvas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, PenLine, Check } from "lucide-react";
import { toast } from "sonner";
import { loadPdf, renderPageToCanvas } from "@/lib/pdf-render";
import type { FieldSnapshot, SignerRole } from "@/lib/agreements";

export function AgreementSigner({
  pdfBytes,
  fields,
  signerRole,
  initialValues,
  onSaveDraft,
  onSubmit,
  signerName,
  signerEmail,
  onSignerInfoChange,
  readOnly,
}: {
  pdfBytes: ArrayBuffer;
  fields: FieldSnapshot[];
  signerRole: SignerRole;
  initialValues: Record<string, { value_text?: string | null; value_signature_data_url?: string | null }>;
  onSaveDraft: (values: Record<string, { value_text?: string | null; value_signature_data_url?: string | null }>) => Promise<void>;
  onSubmit: () => Promise<void>;
  signerName: string;
  signerEmail: string;
  onSignerInfoChange: (name: string, email: string) => void;
  readOnly?: boolean;
}) {
  const [doc, setDoc] = useState<any>(null);
  const [pageCount, setPageCount] = useState(1);
  const [pageSizes, setPageSizes] = useState<Record<number, { w: number; h: number }>>({});
  const canvasRefs = useRef<Record<number, HTMLCanvasElement | null>>({});
  const [values, setValues] = useState(initialValues);
  const [sigField, setSigField] = useState<FieldSnapshot | null>(null);
  const sigPadRef = useRef<SignaturePad | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savedTick, setSavedTick] = useState(0);

  useEffect(() => { setValues(initialValues); }, [initialValues]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await loadPdf(pdfBytes);
        if (cancelled) return;
        setDoc(d);
        setPageCount(d.numPages);
      } catch (e: any) {
        toast.error("Failed to load PDF: " + e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [pdfBytes]);

  useEffect(() => {
    if (!doc) return;
    (async () => {
      for (let p = 1; p <= doc.numPages; p++) {
        const canvas = canvasRefs.current[p];
        if (!canvas) continue;
        const page = await doc.getPage(p);
        const { width, height } = await renderPageToCanvas(page, canvas, 1.4);
        setPageSizes((s) => ({ ...s, [p]: { w: width, h: height } }));
      }
    })();
  }, [doc]);

  const myFields = useMemo(() => fields.filter((f) => f.signer_role === signerRole), [fields, signerRole]);
  const missing = myFields.filter((f) => {
    if (!f.required) return false;
    const v = values[f.internal_name];
    if (f.field_type === "signature" || f.field_type === "initial") return !v?.value_signature_data_url;
    if (f.field_type === "checkbox") return v?.value_text !== "true";
    return !(v?.value_text && v.value_text.trim());
  });

  function updateValue(name: string, patch: { value_text?: string | null; value_signature_data_url?: string | null }) {
    setValues((v) => ({ ...v, [name]: { ...v[name], ...patch } }));
    setSavedTick((t) => t + 1);
  }

  // Debounced autosave
  useEffect(() => {
    if (!savedTick || readOnly) return;
    const t = setTimeout(() => { onSaveDraft(values).catch(() => {}); }, 800);
    return () => clearTimeout(t);
  }, [savedTick, values, readOnly, onSaveDraft]);

  async function handleSubmit() {
    if (readOnly) return;
    if (!signerName.trim() || !signerEmail.trim()) {
      toast.error("Enter your full name and email before signing");
      return;
    }
    if (missing.length) {
      toast.error(`Complete ${missing.length} required field${missing.length === 1 ? "" : "s"} first`);
      return;
    }
    setSubmitting(true);
    try {
      await onSaveDraft(values);
      await onSubmit();
    } finally {
      setSubmitting(false);
    }
  }

  function openSig(f: FieldSnapshot) { setSigField(f); }
  function clearSig() { sigPadRef.current?.clear(); }
  function acceptSig() {
    if (!sigField || !sigPadRef.current) return;
    if (sigPadRef.current.isEmpty()) { toast.error("Draw your signature first"); return; }
    const dataUrl = sigPadRef.current.toDataURL("image/png");
    updateValue(sigField.internal_name, { value_signature_data_url: dataUrl });
    setSigField(null);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
      <div className="space-y-6">
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
          <div key={p}>
            <div className="text-xs text-muted-foreground mb-1">Page {p}</div>
            <div className="relative border rounded-md overflow-hidden bg-muted inline-block">
              <canvas ref={(el) => { canvasRefs.current[p] = el; }} className="block max-w-full" />
              {fields.filter((f) => f.page === p).map((f) => {
                const ps = pageSizes[p];
                if (!ps) return null;
                const mine = f.signer_role === signerRole;
                const v = values[f.internal_name];
                const filled = (f.field_type === "signature" || f.field_type === "initial")
                  ? !!v?.value_signature_data_url
                  : f.field_type === "checkbox"
                    ? v?.value_text === "true"
                    : !!(v?.value_text && v.value_text.trim());
                return (
                  <div
                    key={f.id}
                    className={"absolute flex items-center justify-center text-[10px] " +
                      (filled
                        ? "bg-emerald-500/20 border border-emerald-500"
                        : mine
                          ? "bg-amber-500/20 border border-amber-500 cursor-pointer hover:bg-amber-500/30"
                          : "bg-muted/40 border border-border")}
                    style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%` }}
                    onClick={() => {
                      if (!mine || readOnly) return;
                      if (f.field_type === "signature" || f.field_type === "initial") openSig(f);
                    }}
                    title={`${f.label || f.internal_name} (${f.signer_role})`}
                  >
                    {(f.field_type === "signature" || f.field_type === "initial") && v?.value_signature_data_url ? (
                      <img src={v.value_signature_data_url} alt="signature" className="object-contain max-h-full max-w-full" />
                    ) : f.field_type === "checkbox" ? (
                      v?.value_text === "true" ? <Check className="h-3 w-3 text-emerald-700" /> : null
                    ) : (
                      <span className="truncate px-1 text-foreground/80">{v?.value_text || (mine ? (f.placeholder || f.label) : "")}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <Card className="p-4 h-fit sticky top-4 space-y-4">
        <div>
          <h3 className="font-semibold">Your fields</h3>
          <p className="text-xs text-muted-foreground">Fill in the highlighted fields, then sign and submit.</p>
        </div>
        {!readOnly && (
          <>
            <div className="space-y-2">
              <Label className="text-xs">Your full name</Label>
              <Input value={signerName} onChange={(e) => onSignerInfoChange(e.target.value, signerEmail)} placeholder="As it appears on your ID" />
              <Label className="text-xs">Your email</Label>
              <Input type="email" value={signerEmail} onChange={(e) => onSignerInfoChange(signerName, e.target.value)} />
            </div>
            <div className="border-t pt-3 space-y-3 max-h-[40vh] overflow-y-auto">
              {myFields.map((f) => {
                const v = values[f.internal_name];
                if (f.field_type === "signature" || f.field_type === "initial") {
                  return (
                    <div key={f.id} className="space-y-1">
                      <Label className="text-xs">{f.label || f.internal_name} {f.required && <span className="text-destructive">*</span>}</Label>
                      {v?.value_signature_data_url ? (
                        <div className="flex items-center gap-2">
                          <img src={v.value_signature_data_url} alt="" className="h-10 border rounded bg-white" />
                          <Button size="sm" variant="outline" onClick={() => updateValue(f.internal_name, { value_signature_data_url: null })}>Clear</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => openSig(f)}><PenLine className="h-3 w-3 mr-1" /> Sign</Button>
                      )}
                    </div>
                  );
                }
                if (f.field_type === "checkbox") {
                  return (
                    <div key={f.id} className="flex items-start gap-2">
                      <Checkbox checked={v?.value_text === "true"} onCheckedChange={(c) => updateValue(f.internal_name, { value_text: c ? "true" : "false" })} />
                      <Label className="text-xs leading-snug">{f.label || f.internal_name} {f.required && <span className="text-destructive">*</span>}</Label>
                    </div>
                  );
                }
                if (f.field_type === "address") {
                  return (
                    <div key={f.id} className="space-y-1">
                      <Label className="text-xs">{f.label || f.internal_name} {f.required && <span className="text-destructive">*</span>}</Label>
                      <Textarea rows={2} value={v?.value_text ?? ""} onChange={(e) => updateValue(f.internal_name, { value_text: e.target.value })} placeholder={f.placeholder ?? ""} />
                    </div>
                  );
                }
                return (
                  <div key={f.id} className="space-y-1">
                    <Label className="text-xs">{f.label || f.internal_name} {f.required && <span className="text-destructive">*</span>}</Label>
                    <Input
                      type={f.field_type === "date" ? "date" : f.field_type === "email" ? "email" : f.field_type === "phone" ? "tel" : "text"}
                      value={v?.value_text ?? ""}
                      onChange={(e) => updateValue(f.internal_name, { value_text: e.target.value })}
                      placeholder={f.placeholder ?? ""}
                    />
                  </div>
                );
              })}
              {myFields.length === 0 && <p className="text-xs text-muted-foreground">No fields assigned to you.</p>}
            </div>
            <div className="border-t pt-3">
              <p className="text-xs text-muted-foreground mb-2">
                By submitting, you agree your electronic signature is legally binding.
                {missing.length > 0 && <span className="block mt-1 text-amber-600">{missing.length} required field{missing.length === 1 ? "" : "s"} remaining.</span>}
              </p>
              <Button className="w-full" onClick={handleSubmit} disabled={submitting || missing.length > 0}>
                {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Submit signed agreement
              </Button>
            </div>
          </>
        )}
      </Card>

      <Dialog open={!!sigField} onOpenChange={(o) => !o && setSigField(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{sigField?.field_type === "initial" ? "Initial here" : "Sign here"}</DialogTitle></DialogHeader>
          <div className="border rounded bg-white">
            <SignaturePad ref={sigPadRef} canvasProps={{ className: "w-full h-48" }} penColor="black" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={clearSig}>Clear</Button>
            <Button onClick={acceptSig}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}