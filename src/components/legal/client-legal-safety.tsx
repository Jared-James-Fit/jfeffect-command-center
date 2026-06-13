import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyLegalStatus, listMyAcceptanceHistory, listMyConsents, setConsentPreference, recordAcceptance } from "@/lib/legal.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ShieldCheck, ShieldAlert, FileText, Clock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const OPTIONAL_CONSENTS = [
  { key: "marketing_email", label: "Marketing emails", help: "Promotions, launches, and member news." },
  { key: "testimonial_use", label: "Testimonial use", help: "Allow your coach to share a quote or before/after with attribution." },
  { key: "social_publication", label: "Social media publication", help: "Allow approved photos/videos to appear on JF Effect social accounts." },
  { key: "staff_review", label: "Internal staff review", help: "Allow other staff (not your coach) to review uploads for QA." },
];

/**
 * Client-facing Legal & Safety centre. Mounts inside the existing
 * /portal/account screen — does NOT add a sidebar item.
 */
export function ClientLegalSafety() {
  const statusFn = useServerFn(listMyLegalStatus);
  const historyFn = useServerFn(listMyAcceptanceHistory);
  const consentsFn = useServerFn(listMyConsents);
  const setConsentFn = useServerFn(setConsentPreference);
  const qc = useQueryClient();

  const { data: docs = [] } = useQuery({ queryKey: ["legal-status"], queryFn: () => statusFn() });
  const { data: history = [] } = useQuery({ queryKey: ["legal-history"], queryFn: () => historyFn() });
  const { data: consents = [] } = useQuery({ queryKey: ["legal-consents"], queryFn: () => consentsFn() });

  const required = docs.filter((d: any) => d.is_required);
  const optional = docs.filter((d: any) => !d.is_required && !d.is_optional_consent);
  const consentDocs = docs.filter((d: any) => d.is_optional_consent);

  const toggleConsent = async (key: string, granted: boolean) => {
    try {
      await setConsentFn({ data: { consent_key: key, granted } });
      qc.invalidateQueries({ queryKey: ["legal-consents"] });
      toast.success(granted ? "Consent granted." : "Consent withdrawn.");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update consent.");
    }
  };

  return (
    <Card id="legal" className="border-border bg-card p-6 space-y-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <h3 className="text-base font-bold">Legal & Safety</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Your active agreements, disclaimers, and consents. Required documents must be accepted to use coaching workflows. Optional consents can be withdrawn at any time.
      </p>

      {required.length > 0 && (
        <Section title="Required" docs={required} />
      )}
      {optional.length > 0 && (
        <Section title="Active documents" docs={optional} />
      )}

      {consentDocs.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs uppercase tracking-widest text-muted-foreground">Optional release & consent</h4>
          <div className="space-y-2">
            {consentDocs.map((d: any) => (
              <DocRow key={d.document_id} doc={d} />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2 pt-2 border-t border-border/50">
        <h4 className="text-xs uppercase tracking-widest text-muted-foreground">Communication & marketing preferences</h4>
        <p className="text-xs text-muted-foreground">
          Withdrawing marketing or testimonial consent does <strong>not</strong> affect required coaching communications.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {OPTIONAL_CONSENTS.map((c) => {
            const cur = consents.find((x: any) => x.consent_key === c.key);
            return (
              <div key={c.key} className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/20 p-3">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">{c.label}</div>
                  <div className="text-xs text-muted-foreground">{c.help}</div>
                </div>
                <Switch checked={!!cur?.granted} onCheckedChange={(v) => toggleConsent(c.key, v)} />
              </div>
            );
          })}
        </div>
      </div>

      {history.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border/50">
          <h4 className="text-xs uppercase tracking-widest text-muted-foreground">Acceptance history</h4>
          <ul className="space-y-1 text-xs">
            {history.slice(0, 20).map((h: any) => (
              <li key={h.id} className="flex items-center justify-between gap-2 text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3" />
                  {h.document?.title} <span className="opacity-60">v{h.version?.version_number}</span>
                </span>
                <span>{new Date(h.accepted_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Section({ title, docs }: { title: string; docs: any[] }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs uppercase tracking-widest text-muted-foreground">{title}</h4>
      <div className="space-y-2">
        {docs.map((d) => <DocRow key={d.document_id} doc={d} />)}
      </div>
    </div>
  );
}

function DocRow({ doc }: { doc: any }) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [typedName, setTypedName] = useState("");
  const acceptFn = useServerFn(recordAcceptance);
  const qc = useQueryClient();
  const isAccepted = !!doc.accepted_at;

  const submit = async () => {
    try {
      await acceptFn({ data: {
        document_id: doc.document_id,
        version_id: doc.version.id,
        context: "account_centre",
        signature_method: doc.version.signature_method,
        checkbox_checked: checked || doc.version.signature_method !== "checkbox",
        typed_name: typedName || null,
        acknowledgement_text: doc.version.summary ?? doc.title,
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      }});
      toast.success(`Accepted ${doc.title}.`);
      qc.invalidateQueries({ queryKey: ["legal-status"] });
      qc.invalidateQueries({ queryKey: ["legal-history"] });
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not record acceptance.");
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 p-3">
      <div className="flex items-start gap-2 min-w-0">
        <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{doc.title}</div>
          {doc.version?.summary && (
            <div className="text-xs text-muted-foreground line-clamp-2">{doc.version.summary}</div>
          )}
          <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>v{doc.version?.version_number}</span>
            {isAccepted ? (
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-600">Accepted</Badge>
            ) : doc.is_required ? (
              <Badge variant="outline" className="border-amber-500/40 text-amber-600">Action required</Badge>
            ) : (
              <Badge variant="outline">Active</Badge>
            )}
          </div>
        </div>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button size="sm" variant={isAccepted ? "outline" : "default"}>
            {isAccepted ? "Review" : "Review & accept"}
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{doc.title}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            {doc.version?.summary && (
              <p className="text-sm text-muted-foreground">{doc.version.summary}</p>
            )}
            <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-4 text-sm">
              {doc.version?.body}
            </div>
            {!isAccepted && (
              <div className="space-y-3 border-t border-border pt-4">
                {doc.version?.signature_method === "checkbox" && (
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox checked={checked} onCheckedChange={(v) => setChecked(!!v)} />
                    <span>I have read and accept {doc.title}.</span>
                  </label>
                )}
                {doc.version?.signature_method === "typed_name" && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Type your full legal name to accept</label>
                    <input
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      value={typedName}
                      onChange={(e) => setTypedName(e.target.value)}
                    />
                  </div>
                )}
                <Button onClick={submit} className="w-full">Accept {doc.title}</Button>
              </div>
            )}
            {isAccepted && (
              <div className="text-xs text-muted-foreground">
                Accepted {new Date(doc.accepted_at).toLocaleString()}.
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}