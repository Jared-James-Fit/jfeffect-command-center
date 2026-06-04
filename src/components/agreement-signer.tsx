import { useEffect, useMemo, useRef, useState } from "react";
import SignaturePad from "react-signature-canvas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, PenLine, Check, ArrowDown, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { loadPdf, renderPageToCanvas } from "@/lib/pdf-render";
import type { FieldSnapshot, SignerRole } from "@/lib/agreements";

// Render a typed signature/initial to a PNG data URL using a script-like font.
function typedToDataUrl(text: string, kind: "signature" | "initial"): string {
  const w = kind === "initial" ? 220 : 480;
  const h = kind === "initial" ? 140 : 140;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#000";
  const size = kind === "initial" ? 72 : 56;
  ctx.font = `italic ${size}px "Brush Script MT", "Segoe Script", "Lucida Handwriting", cursive`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(text || "", w / 2, h / 2);
  return canvas.toDataURL("image/png");
}

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
  // Saved signature/initials for this session (tap-to-fill source of truth)
  const [savedSig, setSavedSig] = useState<string | null>(null);
  const [savedInitial, setSavedInitial] = useState<string | null>(null);
  // Modal mode: "create" = build saved sig/init; "field" = direct field edit (legacy)
  const [setupKind, setSetupKind] = useState<"signature" | "initial" | null>(null);
  const [tab, setTab] = useState<"draw" | "type">("draw");
  const [typed, setTyped] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const fieldRefs = useRef<Record<string, HTMLDivElement | null>>({});

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
  const requiredMine = useMemo(() => myFields.filter((f) => f.required), [myFields]);
  function isFilled(f: FieldSnapshot) {
    const v = values[f.internal_name];
    if (f.field_type === "signature" || f.field_type === "initial") return !!v?.value_signature_data_url;
    if (f.field_type === "checkbox") return v?.value_text === "true";
    return !!(v?.value_text && v.value_text.trim());
  }
  const missing = requiredMine.filter((f) => !isFilled(f));
  const completedCount = requiredMine.length - missing.length;

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

  // Tap a signature/initial field. If we already have a saved one, apply it instantly.
  // Otherwise open the create modal.
  function tapSigField(f: FieldSnapshot) {
    const saved = f.field_type === "initial" ? savedInitial : savedSig;
    if (saved) {
      updateValue(f.internal_name, { value_signature_data_url: saved });
      return;
    }
    setSigField(f);
    setSetupKind(f.field_type as "signature" | "initial");
    setTab("draw");
    setTyped("");
  }

  // Open the create dialog explicitly (e.g. from sidebar buttons).
  function openCreate(kind: "signature" | "initial") {
    setSigField(null);
    setSetupKind(kind);
    setTab("draw");
    setTyped("");
  }

  function clearSig() { sigPadRef.current?.clear(); }

  function acceptSig() {
    if (!setupKind) return;
    let dataUrl: string | null = null;
    if (tab === "draw") {
      if (!sigPadRef.current || sigPadRef.current.isEmpty()) { toast.error("Draw first, or switch to Type"); return; }
      dataUrl = sigPadRef.current.toDataURL("image/png");
    } else {
      if (!typed.trim()) { toast.error("Type your " + (setupKind === "initial" ? "initials" : "name")); return; }
      dataUrl = typedToDataUrl(typed.trim(), setupKind);
    }
    if (!dataUrl) return;
    if (setupKind === "initial") setSavedInitial(dataUrl); else setSavedSig(dataUrl);
    // If opened from a specific field, apply to that field immediately
    if (sigField) updateValue(sigField.internal_name, { value_signature_data_url: dataUrl });
    setSigField(null);
    setSetupKind(null);
    toast.success((setupKind === "initial" ? "Initials" : "Signature") + " saved for this session");
  }

  function applyAll(kind: "signature" | "initial") {
    const saved = kind === "initial" ? savedInitial : savedSig;
    if (!saved) { openCreate(kind); return; }
    let count = 0;
    setValues((prev) => {
      const next = { ...prev };
      for (const f of myFields) {
        if (f.field_type !== kind) continue;
        if (next[f.internal_name]?.value_signature_data_url) continue;
        next[f.internal_name] = { ...next[f.internal_name], value_signature_data_url: saved };
        count++;
      }
      return next;
    });
    setSavedTick((t) => t + 1);
    toast.success(`Applied ${kind === "initial" ? "initials" : "signature"} to ${count} field${count === 1 ? "" : "s"}`);
  }

  function jumpToNext() {
    if (!missing.length) { toast.success("All required fields are complete"); return; }
    const next = missing[0];
    const el = fieldRefs.current[next.internal_name];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary");
      setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 1500);
    }
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
                const filled = isFilled(f);
                const isSig = f.field_type === "signature" || f.field_type === "initial";
                const tapLabel = f.field_type === "initial" ? "Tap to initial" : "Tap to sign";
                return (
                  <div
                    key={f.id}
                    ref={(el) => { fieldRefs.current[f.internal_name] = el; }}
                    className={"absolute flex items-center justify-center text-[10px] " +
                      (filled
                        ? "bg-emerald-500/20 border border-emerald-500"
                        : mine
                          ? "bg-amber-500/20 border border-amber-500 cursor-pointer hover:bg-amber-500/30"
                          : "bg-muted/40 border border-border")}
                    style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%` }}
                    onClick={() => {
                      if (!mine || readOnly) return;
                      if (isSig) tapSigField(f);
                    }}
                    title={`${f.label || f.internal_name} (${f.signer_role})`}
                  >
                    {isSig && v?.value_signature_data_url ? (
                      <img src={v.value_signature_data_url} alt="signature" className="object-contain max-h-full max-w-full" />
                    ) : f.field_type === "checkbox" ? (
                      v?.value_text === "true" ? <Check className="h-3 w-3 text-emerald-700" /> : null
                    ) : isSig && mine ? (
                      <span className="truncate px-1 text-amber-800 font-medium">{tapLabel}</span>
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
          <h3 className="font-semibold">Sign agreement</h3>
          <p className="text-xs text-muted-foreground">Create your signature once, then tap fields to fill them.</p>
        </div>
        {!readOnly && (
          <>
            {/* Progress */}
            <div className="rounded border bg-muted/40 p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium">{completedCount} of {requiredMine.length} required fields completed</span>
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={jumpToNext} disabled={!missing.length}>
                  <ArrowDown className="h-3 w-3 mr-1" /> Next
                </Button>
              </div>
              <div className="h-1.5 bg-background rounded mt-2 overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${requiredMine.length ? (completedCount / requiredMine.length) * 100 : 0}%` }} />
              </div>
            </div>

            {/* Saved signature + initials */}
            <div className="space-y-3 border rounded p-3">
              <div className="text-xs font-medium">Your saved marks (this agreement)</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground">Signature</Label>
                  {savedSig ? (
                    <div className="flex items-center gap-1">
                      <img src={savedSig} alt="" className="h-10 border rounded bg-white flex-1 object-contain" />
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setSavedSig(null)}>×</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" className="w-full" onClick={() => openCreate("signature")}>
                      <PenLine className="h-3 w-3 mr-1" /> Create
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" className="w-full" onClick={() => applyAll("signature")} disabled={!myFields.some((f) => f.field_type === "signature")}>
                    <Sparkles className="h-3 w-3 mr-1" /> Apply to all
                  </Button>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground">Initials</Label>
                  {savedInitial ? (
                    <div className="flex items-center gap-1">
                      <img src={savedInitial} alt="" className="h-10 border rounded bg-white flex-1 object-contain" />
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setSavedInitial(null)}>×</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" className="w-full" onClick={() => openCreate("initial")}>
                      <PenLine className="h-3 w-3 mr-1" /> Create
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" className="w-full" onClick={() => applyAll("initial")} disabled={!myFields.some((f) => f.field_type === "initial")}>
                    <Sparkles className="h-3 w-3 mr-1" /> Apply to all
                  </Button>
                </div>
              </div>
            </div>

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
                        <Button size="sm" variant="outline" onClick={() => tapSigField(f)}>
                          <PenLine className="h-3 w-3 mr-1" /> {f.field_type === "initial" ? "Tap to initial" : "Tap to sign"}
                        </Button>
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

      <Dialog open={!!setupKind} onOpenChange={(o) => { if (!o) { setSetupKind(null); setSigField(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create your {setupKind === "initial" ? "initials" : "signature"}</DialogTitle>
          </DialogHeader>
          <div className="flex gap-2 text-xs">
            <Button size="sm" variant={tab === "draw" ? "default" : "outline"} onClick={() => setTab("draw")}>Draw</Button>
            <Button size="sm" variant={tab === "type" ? "default" : "outline"} onClick={() => setTab("type")}>Type</Button>
          </div>
          {tab === "draw" ? (
            <div className="border rounded bg-white">
              <SignaturePad ref={sigPadRef} canvasProps={{ className: "w-full h-48" }} penColor="black" />
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={setupKind === "initial" ? "e.g. JD" : "Your full name"}
                maxLength={setupKind === "initial" ? 6 : 60}
              />
              {typed && (
                <div className="border rounded bg-white p-3 text-center" style={{ fontFamily: '"Brush Script MT", "Segoe Script", "Lucida Handwriting", cursive', fontStyle: "italic", fontSize: setupKind === "initial" ? 48 : 36 }}>
                  {typed}
                </div>
              )}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Saved for this agreement only. You'll be able to tap remaining {setupKind === "initial" ? "initial" : "signature"} fields to fill them instantly.
          </p>
          <DialogFooter>
            {tab === "draw" && <Button variant="outline" onClick={clearSig}>Clear</Button>}
            <Button onClick={acceptSig}>Save & apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}