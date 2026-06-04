import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Trash2, Sparkles, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { loadPdf, renderPageToCanvas, detectFields } from "@/lib/pdf-render";
import { FIELD_TYPES, SIGNER_ROLES, FIELD_LABELS, SIGNER_LABELS, type FieldType, type SignerRole } from "@/lib/agreements";

export interface BuilderField {
  id: string;
  page: number;
  x: number; y: number; width: number; height: number;
  field_type: FieldType;
  signer_role: SignerRole;
  label: string;
  internal_name: string;
  required: boolean;
  placeholder?: string | null;
  options?: string[];
}

export function AgreementPdfBuilder({
  pdfBytes,
  initialFields,
  onSave,
  saving,
}: {
  pdfBytes: ArrayBuffer;
  initialFields: BuilderField[];
  onSave: (fields: BuilderField[], pageCount: number) => Promise<void> | void;
  saving?: boolean;
}) {
  const [doc, setDoc] = useState<any>(null);
  const [pageCount, setPageCount] = useState(1);
  const [fields, setFields] = useState<BuilderField[]>(initialFields);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePage, setActivePage] = useState(1);
  const [pageSizes, setPageSizes] = useState<Record<number, { w: number; h: number }>>({});
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const canvasRefs = useRef<Record<number, HTMLCanvasElement | null>>({});
  const dragRef = useRef<{ id: string; startX: number; startY: number; ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{ id: string; startX: number; startY: number; ow: number; oh: number } | null>(null);

  useEffect(() => { setFields(initialFields); }, [initialFields]);

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

  // Render all pages once doc is ready
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

  const selected = useMemo(() => fields.find((f) => f.id === selectedId) ?? null, [fields, selectedId]);

  function addField(type: FieldType) {
    const id = crypto.randomUUID();
    const n = fields.filter((f) => f.field_type === type).length + 1;
    const baseName = `${type}_${n}`;
    setFields((arr) => [
      ...arr,
      {
        id, page: activePage, x: 0.1, y: 0.1, width: 0.25, height: 0.04,
        field_type: type, signer_role: type === "signature" || type === "initial" ? "client" : "client",
        label: FIELD_LABELS[type], internal_name: baseName, required: true,
      },
    ]);
    setSelectedId(id);
  }

  async function runAutoSuggest() {
    if (!doc) return;
    try {
      const detected = await detectFields(doc);
      if (!detected.length) {
        toast.info("No fields detected. Add fields manually.");
        return;
      }
      const newFields: BuilderField[] = detected.map((d) => ({
        id: crypto.randomUUID(),
        page: d.page, x: d.x, y: d.y, width: d.width, height: d.height,
        field_type: d.field_type as FieldType,
        signer_role: d.signer_role as SignerRole,
        label: d.label, internal_name: d.internal_name, required: true,
      }));
      setFields((arr) => [...arr, ...newFields]);
      toast.success(`Added ${newFields.length} suggested field${newFields.length === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error("Auto-suggest failed: " + e.message);
    }
  }

  function startDrag(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(id);
    const f = fields.find((x) => x.id === id);
    if (!f) return;
    dragRef.current = { id, startX: e.clientX, startY: e.clientY, ox: f.x, oy: f.y };
  }
  function startResize(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(id);
    const f = fields.find((x) => x.id === id);
    if (!f) return;
    resizeRef.current = { id, startX: e.clientX, startY: e.clientY, ow: f.width, oh: f.height };
  }
  useEffect(() => {
    function move(e: MouseEvent) {
      if (dragRef.current) {
        const { id, startX, startY, ox, oy } = dragRef.current;
        const f = fields.find((x) => x.id === id);
        if (!f) return;
        const pg = pageRefs.current[f.page];
        if (!pg) return;
        const rect = pg.getBoundingClientRect();
        const dx = (e.clientX - startX) / rect.width;
        const dy = (e.clientY - startY) / rect.height;
        setFields((arr) => arr.map((x) => x.id === id ? {
          ...x, x: Math.max(0, Math.min(1 - x.width, ox + dx)), y: Math.max(0, Math.min(1 - x.height, oy + dy)),
        } : x));
      } else if (resizeRef.current) {
        const { id, startX, startY, ow, oh } = resizeRef.current;
        const f = fields.find((x) => x.id === id);
        if (!f) return;
        const pg = pageRefs.current[f.page];
        if (!pg) return;
        const rect = pg.getBoundingClientRect();
        const dw = (e.clientX - startX) / rect.width;
        const dh = (e.clientY - startY) / rect.height;
        setFields((arr) => arr.map((x) => x.id === id ? {
          ...x, width: Math.max(0.02, Math.min(1 - x.x, ow + dw)), height: Math.max(0.015, Math.min(1 - x.y, oh + dh)),
        } : x));
      }
    }
    function up() { dragRef.current = null; resizeRef.current = null; }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [fields]);

  function updateSelected(patch: Partial<BuilderField>) {
    if (!selectedId) return;
    setFields((arr) => arr.map((f) => f.id === selectedId ? { ...f, ...patch } : f));
  }
  function deleteSelected() {
    if (!selectedId) return;
    setFields((arr) => arr.filter((f) => f.id !== selectedId));
    setSelectedId(null);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
      {/* PDF canvas + overlay */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 sticky top-0 z-10 bg-background py-2 border-b">
          <span className="text-sm text-muted-foreground mr-2">Add field:</span>
          {FIELD_TYPES.map((t) => (
            <Button key={t} variant="outline" size="sm" onClick={() => addField(t)}>{FIELD_LABELS[t]}</Button>
          ))}
          <Button variant="secondary" size="sm" className="ml-auto" onClick={runAutoSuggest}>
            <Sparkles className="h-4 w-4 mr-1" /> Auto-suggest
          </Button>
          <Button size="sm" onClick={() => onSave(fields, pageCount)} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Save
          </Button>
        </div>
        <div className="space-y-6">
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
            <div key={p}>
              <div className="text-xs text-muted-foreground mb-1">Page {p}</div>
              <div
                ref={(el) => { pageRefs.current[p] = el; }}
                className="relative border rounded-md overflow-hidden bg-muted inline-block"
                onMouseDown={() => setActivePage(p)}
              >
                <canvas ref={(el) => { canvasRefs.current[p] = el; }} className="block max-w-full" />
                {fields.filter((f) => f.page === p).map((f) => {
                  const ps = pageSizes[p];
                  if (!ps) return null;
                  const sel = f.id === selectedId;
                  return (
                    <div
                      key={f.id}
                      onMouseDown={(e) => startDrag(e, f.id)}
                      className={"absolute cursor-move text-[10px] flex items-center px-1 select-none " +
                        (sel ? "bg-primary/30 border-2 border-primary" : "bg-primary/15 border border-primary/50 hover:bg-primary/25")
                      }
                      style={{
                        left: `${f.x * 100}%`, top: `${f.y * 100}%`,
                        width: `${f.width * 100}%`, height: `${f.height * 100}%`,
                      }}
                      title={`${f.label || f.internal_name} (${f.signer_role})`}
                    >
                      <span className="truncate font-medium text-primary">{f.label || f.internal_name}</span>
                      <span
                        onMouseDown={(e) => startResize(e, f.id)}
                        className="absolute right-0 bottom-0 w-2 h-2 bg-primary cursor-se-resize"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Inspector */}
      <Card className="p-4 h-fit sticky top-16 space-y-3">
        <h3 className="font-semibold">Field properties</h3>
        {!selected ? (
          <p className="text-sm text-muted-foreground">Click a field on the PDF to edit it, or add a new field from the toolbar above.</p>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Label</Label>
              <Input value={selected.label} onChange={(e) => updateSelected({ label: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Internal name (no spaces)</Label>
              <Input value={selected.internal_name} onChange={(e) => updateSelected({ internal_name: e.target.value.replace(/[^a-z0-9_]/gi, "_").toLowerCase() })} />
            </div>
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={selected.field_type} onValueChange={(v) => updateSelected({ field_type: v as FieldType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((t) => <SelectItem key={t} value={t}>{FIELD_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Signer</Label>
              <Select value={selected.signer_role} onValueChange={(v) => updateSelected({ signer_role: v as SignerRole })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SIGNER_ROLES.map((r) => <SelectItem key={r} value={r}>{SIGNER_LABELS[r]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Placeholder</Label>
              <Input value={selected.placeholder ?? ""} onChange={(e) => updateSelected({ placeholder: e.target.value })} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Required</Label>
              <Switch checked={selected.required} onCheckedChange={(c) => updateSelected({ required: c })} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><Label className="text-xs">Page</Label><Input type="number" min={1} max={pageCount} value={selected.page} onChange={(e) => updateSelected({ page: Math.max(1, Math.min(pageCount, Number(e.target.value))) })} /></div>
            </div>
            <Button variant="destructive" size="sm" className="w-full" onClick={deleteSelected}>
              <Trash2 className="h-4 w-4 mr-1" /> Delete field
            </Button>
          </div>
        )}
        <div className="border-t pt-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground mb-1">{fields.length} field{fields.length === 1 ? "" : "s"} total</p>
          <p>Drag fields to reposition. Drag the bottom-right corner to resize.</p>
        </div>
      </Card>
    </div>
  );
}