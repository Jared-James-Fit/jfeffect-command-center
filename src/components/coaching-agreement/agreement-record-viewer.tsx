import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, BadgeCheck, CheckCircle2, Loader2, Printer, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getAgreementRecord, type AgreementRecord } from "@/lib/coaching-agreement.functions";
import type { AgreementContent } from "@/lib/coaching-agreement/content";
import { isNative } from "@/platform";
import { AGREEMENT_QUERY_ROOT } from "./agreement-context";
import { AgreementReader } from "./agreement-reader";
import { formatSignedDateTime } from "./agreement-copy";

type Props = {
  signatureId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** The signed copy: the exact words that were agreed to, who signed, and when. */
export function AgreementRecordViewer({ signatureId, open, onOpenChange }: Props) {
  const getRecord = useServerFn(getAgreementRecord);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: [AGREEMENT_QUERY_ROOT, "record", signatureId],
    enabled: open && !!signatureId,
    queryFn: () => getRecord({ data: { signatureId: signatureId! } }),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const content = useMemo<AgreementContent | null>(() => {
    if (!data) return null;
    try {
      return JSON.parse(data.contentJson) as AgreementContent;
    } catch {
      return null;
    }
  }, [data]);

  // iOS app shells can't print; the web version can (Save as PDF).
  const canPrint =
    typeof window !== "undefined" && typeof window.print === "function" && !isNative();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideCloseButton
        className="agreement-print-sheet flex h-full w-full max-w-none flex-col gap-0 overflow-hidden p-0 outline-none sm:max-w-3xl"
      >
        <SheetTitle className="sr-only">Signed Coaching Agreement</SheetTitle>
        <SheetDescription className="sr-only">
          Your signed copy of the JF Effect Coaching Agreement.
        </SheetDescription>

        <header
          className="agreement-no-print flex shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-3 pb-3"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <p className="pl-2 text-sm font-bold">Signed Coaching Agreement</p>
          <div className="flex items-center gap-1">
            {canPrint && data && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-11"
                onClick={() => window.print()}
              >
                <Printer className="mr-1.5 h-4 w-4" /> Print / PDF
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-11"
              aria-label="Close"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </header>

        <div className="agreement-print-root min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-10 pt-4">
          {isLoading && (
            <div className="grid min-h-[40vh] place-items-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}
          {isError && (
            <div className="mx-auto max-w-sm py-16 text-center">
              <AlertTriangle className="mx-auto h-7 w-7 text-amber-500" />
              <p className="mt-3 text-sm text-muted-foreground">
                {(error as Error)?.message ?? "We couldn't open this signed copy."}
              </p>
            </div>
          )}
          {data && content && <RecordBody record={data} content={content} />}
          {data && !content && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              This record's agreement text couldn't be displayed. Contact support.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-foreground">{children}</dd>
    </div>
  );
}

function SignatureBlock({
  heading,
  name,
  method,
  image,
  caption,
}: {
  heading: string;
  name: string;
  method: "drawn" | "typed";
  image: string | null;
  caption: string;
}) {
  return (
    <div className="break-inside-avoid rounded-2xl border border-border bg-card p-4">
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{heading}</p>
      <div className="mt-2 grid min-h-[110px] place-items-center rounded-xl border border-border bg-white p-3">
        {method === "drawn" && image ? (
          <img
            src={image}
            alt={`${heading}: ${name}`}
            className="max-h-28 w-auto max-w-full object-contain"
          />
        ) : (
          <span
            className="max-w-full truncate text-4xl text-slate-900"
            style={{ fontFamily: '"Snell Roundhand", "Segoe Script", "Brush Script MT", cursive' }}
          >
            {name}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm font-semibold">{name}</p>
      <p className="text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}

function RecordBody({ record, content }: { record: AgreementRecord; content: AgreementContent }) {
  const d = record.details ?? {};
  const addr = d.address ?? {};
  const ec1 = d.emergency_contact_1;
  const ec2 = d.emergency_contact_2;
  const payor = d.payor;
  const guardian = record.guardian;
  const signedAt = formatSignedDateTime(
    record.signedAt,
    record.signerTimezone ?? "America/Winnipeg",
  );
  const consentLabels = content.optionalConsents.map((c) => ({
    label: c.label,
    granted: !!record.optionalConsents?.[c.key],
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-emerald-500/50 text-emerald-600">
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Signed
          </Badge>
          <Badge variant="outline">Version {record.version}</Badge>
          {record.integrity ? (
            <Badge variant="outline" className="border-emerald-500/50 text-emerald-600">
              <BadgeCheck className="mr-1 h-3.5 w-3.5" /> Text verified
            </Badge>
          ) : (
            <Badge variant="destructive">Text fingerprint mismatch</Badge>
          )}
        </div>
        <h1 className="text-2xl font-black leading-tight tracking-tight">{content.title}</h1>
        <p className="text-sm text-muted-foreground">{content.subtitle}</p>
        <p className="text-sm text-muted-foreground">
          Signed by <span className="font-semibold text-foreground">{record.typedName}</span> on{" "}
          {signedAt}
        </p>
      </section>

      <section className="break-inside-avoid rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Client details at signing
        </h2>
        <dl className="mt-2 divide-y divide-border/60">
          <Row label="Name">{record.typedName}</Row>
          <Row label="Email">{d.email ?? record.clientEmail ?? "—"}</Row>
          <Row label="Phone">{d.phone ?? "—"}</Row>
          <Row label="Date of birth">
            {d.date_of_birth ?? "—"}
            {typeof d.age_at_signing === "number" ? ` (age ${d.age_at_signing})` : ""}
          </Row>
          <Row label="Address">
            {[addr.street, addr.city, addr.province, addr.postal_code, addr.country]
              .filter(Boolean)
              .join(", ") || "—"}
          </Row>
          <Row label="Emergency contact 1">{ec1 ? `${ec1.name} · ${ec1.phone}` : "—"}</Row>
          {ec2 && <Row label="Emergency contact 2">{`${ec2.name} · ${ec2.phone}`}</Row>}
          {payor && (
            <Row label="Payor">{`${payor.name} (${payor.relationship}) · ${payor.phone} · ${payor.email}`}</Row>
          )}
        </dl>
      </section>

      <section className="break-inside-avoid rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Confirmations
        </h2>
        <ul className="mt-3 space-y-3">
          {record.acknowledgements.map((a) => (
            <li key={a.id} className="flex items-start gap-2.5 text-[14px] leading-snug">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <span className="text-muted-foreground">{a.text}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t border-border/60 pt-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Optional permissions
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {consentLabels.map((c) => (
              <li key={c.label} className="flex justify-between gap-3">
                <span>{c.label}</span>
                <span
                  className={c.granted ? "font-semibold text-emerald-600" : "text-muted-foreground"}
                >
                  {c.granted ? "Allowed" : "Not allowed"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <AgreementReader content={content} variant="record" showIntro showKeyTerms />

      <SignatureBlock
        heading={guardian ? "Client (minor) acknowledgement" : "Client signature"}
        name={record.typedName}
        method={record.signatureMethod}
        image={record.signatureImage}
        caption={`Electronically signed ${signedAt}. ${record.intentStatement}`}
      />
      {guardian && (
        <SignatureBlock
          heading="Parent or guardian signature"
          name={guardian.full_name}
          method={guardian.signature_method}
          image={guardian.signature_image}
          caption={`${guardian.relationship}. ${guardian.statement}`}
        />
      )}

      <section className="break-inside-avoid rounded-2xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">Record</p>
        <p className="mt-1 break-all">
          Document fingerprint (SHA-256): <span className="font-mono">{record.contentHash}</span>
        </p>
        <p className="mt-1">
          Signature ID: <span className="font-mono">{record.id}</span>
        </p>
        {record.audit && (
          <dl className="agreement-no-print mt-3 space-y-1 border-t border-border/60 pt-3">
            <p className="font-semibold text-foreground">Coach-only details</p>
            <p>Verified by: {record.audit.verification.replace(/_/g, " ")}</p>
            <p>IP address: {record.audit.ip ?? "not captured"}</p>
            <p className="break-words">Device: {record.audit.userAgent ?? "not captured"}</p>
            <p>
              Review: opened {record.review?.sections_opened ?? 0} of {content.sections.length}{" "}
              sections over {record.review?.review_seconds ?? 0}s; scrolled to the end:{" "}
              {record.review?.scrolled_to_end ? "yes" : "no"}
            </p>
            <p>
              Receipt email:{" "}
              {record.receiptEmailedAt ? formatSignedDateTime(record.receiptEmailedAt) : "not sent"}
            </p>
            {d.name_matches_profile === false && (
              <p className="font-medium text-amber-600">
                Typed name differs from the account name ({d.profile_name}).
              </p>
            )}
          </dl>
        )}
      </section>
    </div>
  );
}
