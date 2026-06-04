import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { saveTemplateFields } from "@/lib/agreements.functions";
import { AgreementPdfBuilder, type BuilderField } from "@/components/agreement-pdf-builder";
import type { FieldType, SignerRole } from "@/lib/agreements";

export const Route = createFileRoute("/_authenticated/admin/agreements/$id")({
  component: TemplateBuilderPage,
});

function TemplateBuilderPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const save = useServerFn(saveTemplateFields);
  const [saving, setSaving] = useState(false);

  const { data: tpl } = useQuery({
    queryKey: ["agreement-template", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("agreement_templates").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });
  const { data: fields } = useQuery({
    queryKey: ["agreement-template-fields", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("agreement_template_fields")
        .select("*").eq("template_id", id).order("sort_order");
      if (error) throw error;
      return data;
    },
  });
  const { data: pdfBytes } = useQuery({
    queryKey: ["agreement-template-pdf", tpl?.pdf_storage_path],
    enabled: !!tpl?.pdf_storage_path,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("agreements").download(tpl!.pdf_storage_path);
      if (error) throw error;
      return await data.arrayBuffer();
    },
  });

  const [name, setName] = useState("");
  const [reqCoach, setReqCoach] = useState(false);
  const [supportsPayor, setSupportsPayor] = useState(false);
  const [supportsMinor, setSupportsMinor] = useState(false);
  useState(() => {
    if (tpl) {
      setName(tpl.name);
      setReqCoach(tpl.requires_coach_signature);
      setSupportsPayor(tpl.supports_payor);
      setSupportsMinor(tpl.supports_minor);
    }
  });

  if (!tpl || !pdfBytes) {
    return <div className="flex items-center gap-2 text-muted-foreground p-6"><Loader2 className="h-4 w-4 animate-spin" /> Loading template…</div>;
  }

  const initial: BuilderField[] = (fields ?? []).map((f: any) => ({
    id: f.id, page: f.page, x: Number(f.x), y: Number(f.y),
    width: Number(f.width), height: Number(f.height),
    field_type: f.field_type as FieldType, signer_role: f.signer_role as SignerRole,
    label: f.label ?? "", internal_name: f.internal_name, required: f.required,
    placeholder: f.placeholder, options: f.options ?? [],
  }));

  async function handleSave(next: BuilderField[]) {
    setSaving(true);
    try {
      await save({
        data: {
          template_id: id,
          fields: next.map((f) => ({
            page: f.page, x: f.x, y: f.y, width: f.width, height: f.height,
            field_type: f.field_type, signer_role: f.signer_role,
            label: f.label, internal_name: f.internal_name, required: f.required,
            placeholder: f.placeholder ?? null, options: f.options ?? [], sort_order: 0,
          })),
          name: name || tpl!.name,
          requires_coach_signature: reqCoach,
          supports_payor: supportsPayor,
          supports_minor: supportsMinor,
        },
      });
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["agreement-template", id] });
      qc.invalidateQueries({ queryKey: ["agreement-template-fields", id] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Link to="/admin/agreements" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4 mr-1" /> All templates
      </Link>
      <PageHeader title={tpl.name} subtitle={`Version ${tpl.version} · ${tpl.page_count} page${tpl.page_count === 1 ? "" : "s"}`} />
      <Card className="p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <Label className="text-xs">Template name</Label>
          <Input value={name || tpl.name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">Coach signature required</Label>
          <Switch checked={reqCoach} onCheckedChange={setReqCoach} />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">Supports payor</Label>
          <Switch checked={supportsPayor} onCheckedChange={setSupportsPayor} />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">Supports minor (parent/guardian)</Label>
          <Switch checked={supportsMinor} onCheckedChange={setSupportsMinor} />
        </div>
      </Card>
      <AgreementPdfBuilder
        pdfBytes={pdfBytes}
        initialFields={initial}
        onSave={(f) => handleSave(f)}
        saving={saving}
      />
    </div>
  );
}