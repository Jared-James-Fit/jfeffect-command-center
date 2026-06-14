import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listNativeTemplates, createNativePackage } from "@/lib/native-agreements.functions";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/agreements-native/new")({
  component: NewNativeAgreementPage,
  validateSearch: (s: Record<string, unknown>) => ({ clientId: typeof s.clientId === "string" ? s.clientId : "" }),
});

function NewNativeAgreementPage() {
  const search = useSearch({ from: "/_authenticated/admin/agreements-native/new" });
  const nav = useNavigate();
  const listTpl = useServerFn(listNativeTemplates);
  const createFn = useServerFn(createNativePackage);

  const { data: clients = [] } = useQuery({
    queryKey: ["all-clients-mini"],
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, first_name, last_name, email").order("first_name").limit(500);
      return data ?? [];
    },
  });
  const { data: templates = [] } = useQuery({ queryKey: ["na-templates"], queryFn: () => listTpl() });

  const [clientId, setClientId] = useState(search.clientId || "");
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("");
  const [valueDollars, setValueDollars] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");

  // Auto-fill signer from client selection
  function onClient(id: string) {
    setClientId(id);
    const c = (clients as any[]).find((x) => x.id === id);
    if (c) {
      setSignerName(`${c.first_name ?? ""} ${c.last_name ?? ""}`.trim());
      setSignerEmail(c.email ?? "");
    }
  }

  const create = useMutation({
    mutationFn: () => createFn({ data: {
      clientId, templateId, customTitle: title || undefined,
      contractValueMinor: Math.round(Number(valueDollars || "0") * 100),
      currency: "CAD",
      serviceOrder: {},
      financialTerms: {},
      signers: [{ role: "client", fullName: signerName, email: signerEmail, ordinal: 1 }],
    } }),
    onSuccess: (res) => {
      toast.success("Package created");
      nav({ to: "/admin/agreements-native/$packageId", params: { packageId: res.packageId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ready = clientId && templateId && signerName && signerEmail && valueDollars;

  return (
    <div className="space-y-4 max-w-2xl">
      <PageHeader title="New Native Agreement" subtitle="Create a draft package, review, then seal & send." />
      <Card className="p-4 space-y-4">
        <div>
          <Label>Client</Label>
          <Select value={clientId} onValueChange={onClient}>
            <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
            <SelectContent>
              {(clients as any[]).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.first_name} {c.last_name} — {c.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Template</Label>
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
            <SelectContent>
              {(templates as any[]).map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.internal_name} ({t.service_type})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Title (optional)</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 12-Session PT Package" />
        </div>
        <div>
          <Label>Contract value (CAD)</Label>
          <Input type="number" value={valueDollars} onChange={(e) => setValueDollars(e.target.value)} placeholder="3000" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Signer name</Label>
            <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} />
          </div>
          <div>
            <Label>Signer email</Label>
            <Input value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} />
          </div>
        </div>
        <Button disabled={!ready || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? "Creating…" : "Create draft"}
        </Button>
      </Card>
      <p className="text-xs text-muted-foreground">
        Note: Templates and the Manitoba jurisdiction profile are seeded as <em>legal_review_required</em>. Until a legal operator publishes them, packages will be created in <em>legal_review_required</em> status and cannot be sent.
      </p>
    </div>
  );
}