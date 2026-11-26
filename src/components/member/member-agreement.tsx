import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AgreementAccessScreen } from "@/components/legal/agreement-access-screen";
import { CheckCircle2, ExternalLink, FileSignature, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { acceptMembershipAgreement, getMyMembershipAgreement } from "@/lib/membership-agreement.functions";
import { MEMBERSHIP_AGREEMENT_ACKS, MEMBERSHIP_AGREEMENT_SUMMARY } from "@/lib/membership-agreement/acks";
import { supabase } from "@/integrations/supabase/client";

const QUERY_ROOT = "membership-agreement";

export function useMembershipAgreement() {
  const { user } = useAuth();
  const fetch = useServerFn(getMyMembershipAgreement);
  return useQuery({
    queryKey: [QUERY_ROOT, user?.id ?? "anon"],
    enabled: !!user?.id,
    queryFn: () => fetch(),
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";

/** Review and explicitly accept the published agreement; legacy versions retain their original method. */
function MemberAgreementSheet({
  open,
  onOpenChange,
  required = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  required?: boolean;
}) {
  const qc = useQueryClient();
  const { data } = useMembershipAgreement();
  const accept = useServerFn(acceptMembershipAgreement);
  const [ticks, setTicks] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTicks([]);
      setName("");
    }
  }, [open]);

  if (!data?.applicable) return null;
  const v = data.version;
  const requiresName = v.signature_method === "typed_name";
  const ready = ticks.length === MEMBERSHIP_AGREEMENT_ACKS.length && (!requiresName || name.trim().length >= 2);

  const submit = async () => {
    if (!ready || saving) return;
    setSaving(true);
    try {
      await accept({ data: { versionId: v.id, ...(requiresName ? { typedName: name.trim() } : {}), acks: ticks } });
      await Promise.all([qc.invalidateQueries({ queryKey: [QUERY_ROOT] }), qc.invalidateQueries({ queryKey: ["legal-status"] })]);
      toast.success("Membership Agreement accepted", { description: "Your copy is in Account → Agreement." });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save that. Try again.");
      void qc.invalidateQueries({ queryKey: [QUERY_ROOT] });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={required ? () => {} : onOpenChange}>
      <SheetContent side="bottom" safeTopClose hideCloseButton={required} onEscapeKeyDown={required ? (e) => e.preventDefault() : undefined} onPointerDownOutside={required ? (e) => e.preventDefault() : undefined} className="h-[95dvh] overflow-hidden p-0">
        <div className="flex h-full flex-col">
          <SheetHeader className={`shrink-0 border-b py-4 pr-4 text-left ${required ? "pl-4" : "pl-28"}`}>
            {required && <p className="text-xs font-semibold uppercase tracking-wider text-primary">Account setup · Required</p>}
            <SheetTitle className="flex items-center gap-2">
              <FileSignature className="h-5 w-5 text-primary" /> {v.title}
            </SheetTitle>
            <SheetDescription>
              {data.acceptedEarlier
                ? "We updated the agreement. Read what's new and agree to continue. "
                : data.acceptedAt
                  ? "One last step: confirm the health and safety terms and agree. "
                  : ""}
              Version {v.version_number}
              {v.effective_date ? ` · effective ${fmtDate(v.effective_date)}` : ""}
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4">
            <section>
              <h3 className="text-sm font-bold">The short version</h3>
              <ul className="mt-2 space-y-1.5">
                {MEMBERSHIP_AGREEMENT_SUMMARY.map((line) => (
                  <li key={line} className="flex gap-2 text-sm leading-snug">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-muted-foreground">The full agreement below is what you're agreeing to.</p>
            </section>

            <details className="group rounded-xl border bg-secondary/20">
              <summary className="cursor-pointer select-none px-3 py-2.5 text-sm font-semibold">Read the full agreement</summary>
              <div className="max-h-[50dvh] overflow-y-auto whitespace-pre-wrap border-t px-3 py-3 text-xs leading-relaxed text-foreground/90">
                {v.body}
              </div>
            </details>
            <a
              href="/legal/membership-agreement"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
            >
              Open it on its own page <ExternalLink className="h-3 w-3" />
            </a>

            <section className="space-y-3">
              {MEMBERSHIP_AGREEMENT_ACKS.map((a) => {
                const on = ticks.includes(a.id);
                return (
                  <label key={a.id} className="flex cursor-pointer items-start gap-3 rounded-xl border p-3">
                    <Checkbox
                      checked={on}
                      onCheckedChange={(c) =>
                        setTicks((cur) => (c ? Array.from(new Set([...cur, a.id])) : cur.filter((x) => x !== a.id)))
                      }
                      className="mt-0.5"
                    />
                    <span className="text-sm leading-snug">{a.text}</span>
                  </label>
                );
              })}
            </section>

            {requiresName && <div>
              <Label htmlFor="member-agreement-name" className="text-sm font-semibold">Type your full name to sign</Label>
              <Input
                id="member-agreement-name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
                className="mt-1.5 h-11 text-base"
              />
            </div>}
          </div>

          <div className="shrink-0 space-y-2 border-t bg-background px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]">
            <Button onClick={() => void submit()} disabled={!ready || saving} className="h-12 w-full text-base font-bold">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Agree & continue
            </Button>
            {required && <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground"><a href="mailto:support@jfeffect.com" className="underline">Contact support</a><Button variant="ghost" size="sm" onClick={async () => { await supabase.auth.signOut(); window.location.href = "/auth"; }}>Sign out</Button></div>}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Legal acceptance precedes account setup and every portal screen. No dismissal state. */
export function MemberAgreementGate({ children }: { children: ReactNode }) {
  const q = useMembershipAgreement();
  if (q.isError || !q.data) return <AgreementAccessScreen checking={!q.isError} retry={() => void q.refetch()} />;
  if (q.data.applicable && q.data.needsSigning) {
    return <><AgreementAccessScreen title="Membership agreement required" /><MemberAgreementSheet key={q.data.version.id} open required onOpenChange={() => {}} /></>;
  }
  return <>{children}</>;
}

/** Where a member's agreement stands, for the Account row: "Signed" / "Accepted" / "Action required"; null when it doesn't apply. */
export function membershipAgreementStatus(data: ReturnType<typeof useMembershipAgreement>["data"]): { label: string; needsYou: boolean } | null {
  if (!data?.applicable) return null;
  if (data.signedAt) return { label: "Accepted", needsYou: false };
  if (!data.needsSigning && data.acceptedAt) return { label: "Accepted", needsYou: false };
  if (data.needsSigning) return { label: "Action required", needsYou: true };
  // applicable but nothing to do (an older version): the row stays, with no status
  return { label: "", needsYou: false };
}

/**
 * Account → Agreement for a JF member: signed (with the date) or a button to
 * review and sign. A plain block inside its Account section, which carries the
 * agreement's name and its status (`membershipAgreementStatus`).
 */
export function MemberAgreementCard() {
  const { data } = useMembershipAgreement();
  const [open, setOpen] = useState(false);
  if (!data?.applicable) return null;
  const v = data.version;
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">{v.title}</div>
      <p className="text-sm text-muted-foreground">
        {data.signedAt
          ? `You accepted version ${data.acceptedVersionNumber ?? v.version_number} on ${fmtDate(data.signedAt)}.${data.acceptedVersionNumber !== v.version_number ? " No new acceptance is required for this update." : ""}`
          : data.acceptedAt && !data.needsSigning
            ? `You accepted version ${v.version_number} at checkout on ${fmtDate(data.acceptedAt)}.`
            : `Version ${v.version_number} covers your membership, training safety, Crew and billing. It takes about two minutes.`}
      </p>
      <div className="flex flex-wrap gap-2">
        {data.needsSigning && <Button onClick={() => setOpen(true)}>Review and accept</Button>}
        <Button variant="outline" asChild>
          <a href="/legal/membership-agreement" target="_blank" rel="noreferrer">
            Read the agreement <ExternalLink className="ml-1 h-3.5 w-3.5" />
          </a>
        </Button>
      </div>
      {data.needsSigning && <MemberAgreementSheet open={open} onOpenChange={setOpen} />}
    </div>
  );
}
