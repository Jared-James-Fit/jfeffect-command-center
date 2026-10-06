import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Loader2,
  PenLine,
  RefreshCw,
  Type,
  UserRound,
  WifiOff,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useOnlineStatus } from "@/hooks/use-online-status";
import {
  getAgreementSigningContext,
  signCoachingAgreement,
  type SigningContext,
} from "@/lib/coaching-agreement.functions";
import {
  AGREEMENT_CONTENT,
  AGREEMENT_CONTENT_JSON,
  type AgreementContent,
} from "@/lib/coaching-agreement/content";
import { sha256HexAsync } from "@/lib/coaching-agreement/hash";
import { isMinor } from "@/lib/coaching-agreement/rules";
import {
  describeDetailsErrors,
  missingForSigning,
  type MissingItem,
} from "@/lib/coaching-agreement/readiness";
import { detailsSchema, guardianSchema } from "@/lib/coaching-agreement/schemas";
import { AGREEMENT_QUERY_ROOT } from "./agreement-context";
import { AgreementReader } from "./agreement-reader";
import { SignaturePad } from "./signature-pad";
import { agreementPrompt, formatSignedDate } from "./agreement-copy";
import { AgreementRecordViewer } from "./agreement-record-viewer";

type Step = 0 | 1 | 2;
type Method = "drawn" | "typed";

type FormState = {
  phone: string;
  dateOfBirth: string;
  street: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  ec1Name: string;
  ec1Phone: string;
  ec2Name: string;
  ec2Phone: string;
  payorName: string;
  payorRelationship: string;
  payorPhone: string;
  payorEmail: string;
  guardianName: string;
  guardianRelationship: string;
  guardianPhone: string;
};

type Draft = {
  clientId: string;
  step: Step;
  form: FormState;
  payorOn: boolean;
  payorConfirmed: boolean;
  consents: Record<string, boolean>;
  acked: string[];
  typedName: string;
  method: Method;
  signature: string | null;
  guardianAck: boolean;
  guardianMethod: Method;
  guardianSignature: string | null;
  reviewedEnd: boolean;
};

/**
 * In-memory only (never written to disk): if the client closes the sheet to look
 * something up, their typed details and signature are still there when they come back.
 */
let draft: Draft | null = null;

const FULLSCREEN =
  "outline-none left-0 top-0 flex h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:left-1/2 sm:top-1/2 sm:h-[min(52rem,calc(100dvh-2rem))] sm:max-h-[calc(100dvh-2rem)] sm:w-[min(44rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:p-0";

const STEP_TITLES = ["Review", "Your details", "Agree & sign"] as const;

/** Which validation error keys a field edit should clear. */
const ERROR_KEYS: Record<keyof FormState, string[]> = {
  phone: ["phone"],
  dateOfBirth: ["dateOfBirth"],
  street: ["address.street"],
  city: ["address.city"],
  province: ["address.province"],
  postalCode: ["address.postalCode"],
  country: ["address.country"],
  ec1Name: ["emergencyContact1.name"],
  ec1Phone: ["emergencyContact1.phone"],
  ec2Name: ["emergencyContact2.name", "emergencyContact2.phone"],
  ec2Phone: ["emergencyContact2.name", "emergencyContact2.phone"],
  payorName: ["payor.name"],
  payorRelationship: ["payor.relationship"],
  payorPhone: ["payor.phone"],
  payorEmail: ["payor.email"],
  guardianName: ["guardian.fullName"],
  guardianRelationship: ["guardian.relationship"],
  guardianPhone: ["guardian.phone"],
};

function emptyForm(profile: SigningContext["profile"]): FormState {
  return {
    phone: profile.phone,
    dateOfBirth: profile.dateOfBirth ?? "",
    street: profile.street,
    city: profile.city,
    province: profile.province,
    postalCode: profile.postalCode,
    country: profile.country || "Canada",
    ec1Name: profile.emergencyContactName,
    ec1Phone: profile.emergencyContactPhone,
    ec2Name: "",
    ec2Phone: "",
    payorName: "",
    payorRelationship: "",
    payorPhone: "",
    payorEmail: "",
    guardianName: "",
    guardianRelationship: "",
    guardianPhone: "",
  };
}

function issuesToErrors(issues: { path: (string | number)[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

function detailsInput(form: FormState, payorOn: boolean) {
  const hasEc2 = form.ec2Name.trim() !== "" || form.ec2Phone.trim() !== "";
  return {
    phone: form.phone,
    dateOfBirth: form.dateOfBirth,
    address: {
      street: form.street,
      city: form.city,
      province: form.province,
      postalCode: form.postalCode,
      country: form.country,
    },
    emergencyContact1: { name: form.ec1Name, phone: form.ec1Phone },
    emergencyContact2: hasEc2 ? { name: form.ec2Name, phone: form.ec2Phone } : null,
    // The client confirms the payor in the last step; here only the contact details are checked.
    payor: payorOn
      ? {
          name: form.payorName,
          relationship: form.payorRelationship,
          phone: form.payorPhone,
          email: form.payorEmail,
          confirmed: true as const,
        }
      : null,
  };
}

export function AgreementSignFlow({
  open,
  onOpenChange,
  onSigned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSigned?: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const getContext = useServerFn(getAgreementSigningContext);
  const sign = useServerFn(signCoachingAgreement);
  const content: AgreementContent = AGREEMENT_CONTENT;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const startedAt = useRef<number>(Date.now());
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const openedCount = useRef(0);

  const [step, setStep] = useState<Step>(0);
  const [reviewedEnd, setReviewedEnd] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [payorOn, setPayorOn] = useState(false);
  const [payorConfirmed, setPayorConfirmed] = useState(false);
  const [consents, setConsents] = useState<Record<string, boolean>>({});
  const [acked, setAcked] = useState<string[]>([]);
  const [typedName, setTypedName] = useState("");
  const [method, setMethod] = useState<Method>("drawn");
  const [signature, setSignature] = useState<string | null>(null);
  const [guardianAck, setGuardianAck] = useState(false);
  const [guardianMethod, setGuardianMethod] = useState<Method>("drawn");
  const [guardianSignature, setGuardianSignature] = useState<string | null>(null);
  const [localHash, setLocalHash] = useState<string | null>(null);
  const [signed, setSigned] = useState<{ signatureId: string } | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [initFor, setInitFor] = useState<string | null>(null);
  // Once someone has tried to continue, show exactly what is still missing and keep it live.
  const [detailsAttempted, setDetailsAttempted] = useState(false);
  const [signAttempted, setSignAttempted] = useState(false);
  const [reviewNudge, setReviewNudge] = useState<number | null>(null);
  const detailsAttemptedRef = useRef(false);
  detailsAttemptedRef.current = detailsAttempted;

  // What this device is actually showing, as a fingerprint.
  useEffect(() => {
    let cancelled = false;
    sha256HexAsync(AGREEMENT_CONTENT_JSON)
      .then((h) => !cancelled && setLocalHash(h))
      .catch(() => !cancelled && setLocalHash(null));
    return () => {
      cancelled = true;
    };
  }, []);

  const ctxQuery = useQuery({
    queryKey: [AGREEMENT_QUERY_ROOT, "signing-context", user?.id ?? "anon"],
    enabled: open && !!user?.id && !signed,
    queryFn: () => getContext(),
    staleTime: 0,
    gcTime: 0,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const ctx = ctxQuery.data;

  // Restore a draft, or start from the profile.
  useEffect(() => {
    if (!ctx || initFor === ctx.clientId) return;
    if (draft && draft.clientId === ctx.clientId) {
      setStep(draft.step);
      setForm(draft.form);
      setPayorOn(draft.payorOn);
      setPayorConfirmed(draft.payorConfirmed);
      setConsents(draft.consents);
      setAcked(draft.acked);
      setTypedName(draft.typedName);
      setMethod(draft.method);
      setSignature(draft.signature);
      setGuardianAck(draft.guardianAck);
      setGuardianMethod(draft.guardianMethod);
      setGuardianSignature(draft.guardianSignature);
      setReviewedEnd(draft.reviewedEnd);
    } else {
      setStep(0);
      setForm(emptyForm(ctx.profile));
      setConsents({ ...ctx.consents });
      setTypedName(ctx.profile.fullName);
    }
    setInitFor(ctx.clientId);
  }, [ctx, initFor]);

  // Keep the draft current.
  useEffect(() => {
    if (!ctx || !form || signed) return;
    draft = {
      clientId: ctx.clientId,
      step,
      form,
      payorOn,
      payorConfirmed,
      consents,
      acked,
      typedName,
      method,
      signature,
      guardianAck,
      guardianMethod,
      guardianSignature,
      reviewedEnd,
    };
  }, [
    ctx,
    form,
    step,
    payorOn,
    payorConfirmed,
    consents,
    acked,
    typedName,
    method,
    signature,
    guardianAck,
    guardianMethod,
    guardianSignature,
    reviewedEnd,
    signed,
  ]);

  // Each fresh open starts the review clock.
  useEffect(() => {
    if (open) startedAt.current = Date.now();
  }, [open]);

  // "Scroll to the end" gate on the review step. The end marker only exists once the form has
  // been initialised (a render after the context arrives), so that is a dependency too.
  const formReady = !!form;
  useEffect(() => {
    if (!open || step !== 0 || reviewedEnd || !ctx || !formReady) return;
    const root = scrollRef.current;
    const target = endRef.current;
    if (!root || !target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setReviewedEnd(true);
      },
      { root, threshold: 0.6 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [open, step, reviewedEnd, ctx, formReady]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setDetailsAttempted(false);
    setSignAttempted(false);
    setReviewNudge(null);
    setErrors({});
  }, [step]);

  useEffect(() => {
    if (reviewedEnd) setReviewNudge(null);
  }, [reviewedEnd]);

  const dob = form?.dateOfBirth ?? "";
  const minor = useMemo(() => isMinor(dob, new Date()), [dob]);
  const dobLocked = !!ctx?.profile.dateOfBirth;
  const staleBundle = !!ctx && !!localHash && localHash !== ctx.contentHash;
  const alreadyCurrent = !!ctx && ctx.state.state !== "needs_signature" && !signed;

  const patch = useCallback((next: Partial<FormState>) => {
    setForm((prev) => (prev ? { ...prev, ...next } : prev));
    // After the first attempt, live re-validation owns the errors so a half-typed value
    // doesn't look fixed.
    if (detailsAttemptedRef.current) return;
    setErrors((prev) => {
      const copy = { ...prev };
      for (const field of Object.keys(next) as (keyof FormState)[]) {
        for (const errorKey of ERROR_KEYS[field]) delete copy[errorKey];
      }
      return copy;
    });
  }, []);

  const computeDetailErrors = useCallback((): Record<string, string> => {
    if (!form) return {};
    const found: Record<string, string> = {};
    const parsed = detailsSchema.safeParse(detailsInput(form, payorOn));
    if (!parsed.success) Object.assign(found, issuesToErrors(parsed.error.issues));
    if (minor) {
      const guardian = guardianSchema
        .pick({ fullName: true, relationship: true, phone: true })
        .safeParse({
          fullName: form.guardianName,
          relationship: form.guardianRelationship,
          phone: form.guardianPhone,
        });
      if (!guardian.success) {
        for (const issue of guardian.error.issues) {
          found[`guardian.${issue.path.join(".")}`] = issue.message;
        }
      }
    }
    return found;
  }, [form, payorOn, minor]);

  // After the first failed attempt the list of what's missing stays live as they fill things in.
  useEffect(() => {
    if (detailsAttempted) setErrors(computeDetailErrors());
  }, [detailsAttempted, computeDetailErrors]);

  /** Scrolls to something that still needs attention and, for inputs and boxes, focuses it. */
  const jumpTo = useCallback((anchor: string) => {
    const el = document.getElementById(anchor);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    if (el.matches("input, textarea, button")) el.focus({ preventScroll: true });
  }, []);

  const validateDetails = (): boolean => {
    if (!form) return false;
    const found = computeDetailErrors();
    setDetailsAttempted(true);
    setErrors(found);
    const items = describeDetailsErrors(found);
    if (items.length > 0) {
      requestAnimationFrame(() => jumpTo(items[0].anchor));
      return false;
    }
    return true;
  };

  const missing = missingForSigning({
    acknowledgements: content.acknowledgements,
    acked,
    payorOn,
    payorConfirmed,
    typedName,
    minor,
    method,
    hasSignature: !!signature,
    guardianName: form?.guardianName ?? "",
    guardianAck,
    guardianMethod,
    hasGuardianSignature: !!guardianSignature,
    online,
  });
  const missingKeys = new Set(missing.map((m) => m.key));

  /** How far down the agreement they've scrolled, for the "keep going" message. */
  const readProgress = () => {
    const el = scrollRef.current;
    if (!el) return 0;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return 99;
    return Math.min(99, Math.max(0, Math.round((el.scrollTop / max) * 100)));
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form || !ctx || !localHash) throw new Error("Not ready yet");
      const details = detailsInput(form, payorOn);
      return sign({
        data: {
          idempotencyKey: idempotencyKey.current,
          contentHash: localHash,
          typedLegalName: typedName.trim(),
          // Under 18: the parent or guardian provides the signature; the minor's typed name
          // is their own acknowledgement.
          signatureMethod: minor ? "typed" : method,
          signatureImage: !minor && method === "drawn" ? signature : null,
          details: {
            ...details,
            payor: details.payor ? { ...details.payor, confirmed: payorConfirmed as true } : null,
          },
          acknowledged: acked,
          optionalConsents: consents,
          guardian: minor
            ? {
                fullName: form.guardianName.trim(),
                relationship: form.guardianRelationship.trim(),
                phone: form.guardianPhone.trim(),
                signatureMethod: guardianMethod,
                signatureImage: guardianMethod === "drawn" ? guardianSignature : null,
                acknowledged: guardianAck as true,
              }
            : null,
          review: {
            sectionsOpened: openedCount.current,
            reviewSeconds: Math.min(86_400, Math.round((Date.now() - startedAt.current) / 1000)),
            scrolledToEnd: reviewedEnd,
          },
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
    },
    onSuccess: (result) => {
      draft = null;
      idempotencyKey.current = crypto.randomUUID();
      setSigned({ signatureId: result.signatureId });
      toast.success("Agreement signed");
      // Everything that shows signing status refreshes now.
      queryClient.invalidateQueries({ queryKey: [AGREEMENT_QUERY_ROOT] });
      queryClient.invalidateQueries({ queryKey: ["setup-banner-client"] });
      queryClient.invalidateQueries({ queryKey: ["my-client-account"] });
      queryClient.invalidateQueries({ queryKey: ["my-client"] });
      onSigned?.();
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "We couldn't save your signature.";
      if (message.startsWith("agreement_changed")) {
        toast.error("The agreement was just updated", {
          description: "Reload to review the latest version before signing.",
        });
      } else {
        toast.error(message.replace(/^[a-z_]+:\s*/, ""));
      }
    },
  });

  const resetAfterSigning = () => {
    setSigned(null);
    setViewerOpen(false);
    setInitFor(null);
    setStep(0);
    setReviewedEnd(false);
    setAcked([]);
    setSignature(null);
    setGuardianAck(false);
    setGuardianSignature(null);
    setPayorConfirmed(false);
    setForm(null);
    setDetailsAttempted(false);
    setSignAttempted(false);
    setReviewNudge(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && mutation.isPending) return;
    if (!next && signed) resetAfterSigning();
    onOpenChange(next);
  };

  const close = () => handleOpenChange(false);

  // ---------------------------------------------------------------- render
  const prompt = agreementPrompt(
    ctx
      ? {
          applicable: true,
          reason: "ok",
          clientId: ctx.clientId,
          firstName: null,
          state: ctx.state,
          currentVersion: ctx.currentVersion,
          contentHash: ctx.contentHash,
          legacy: ctx.legacy,
        }
      : undefined,
  );

  let body: ReactNode;
  let footer: ReactNode = null;

  if (signed) {
    body = (
      <SuccessView
        email={ctx?.profile.email ?? user?.email ?? ""}
        onView={() => setViewerOpen(true)}
        onDone={close}
      />
    );
  } else if (ctxQuery.isLoading || (ctx && !form)) {
    body = (
      <CenteredNote
        icon={<Loader2 className="h-6 w-6 animate-spin text-primary" />}
        text="Opening your agreement…"
      />
    );
  } else if (ctxQuery.isError || !ctx) {
    body = (
      <CenteredNote
        icon={<AlertTriangle className="h-7 w-7 text-amber-500" />}
        title="We couldn't open your agreement"
        text={
          (ctxQuery.error as Error | null)?.message ?? "Please check your connection and try again."
        }
        action={
          <Button type="button" onClick={() => ctxQuery.refetch()} className="h-11">
            <RefreshCw className="mr-2 h-4 w-4" /> Try again
          </Button>
        }
      />
    );
  } else if (alreadyCurrent) {
    body = (
      <CenteredNote
        icon={<CheckCircle2 className="h-8 w-8 text-emerald-500" />}
        title="You're already up to date"
        text="Your Coaching Agreement is signed. You can view your signed copy any time under Account."
        action={
          <Button type="button" onClick={close} className="h-11">
            Done
          </Button>
        }
      />
    );
  } else if (staleBundle) {
    body = (
      <CenteredNote
        icon={<RefreshCw className="h-7 w-7 text-primary" />}
        title="A newer version is available"
        text="The agreement was updated since this screen loaded. Reload the app so you review and sign the latest wording."
        action={
          <Button type="button" onClick={() => window.location.reload()} className="h-11">
            <RefreshCw className="mr-2 h-4 w-4" /> Reload
          </Button>
        }
      />
    );
  } else if (form) {
    if (step === 0) {
      body = (
        <ReviewStep
          content={content}
          title={prompt.title}
          intro={prompt.body}
          note={prompt.note}
          onOpened={(n) => {
            openedCount.current = n;
          }}
          endRef={endRef}
          reviewedEnd={reviewedEnd}
        />
      );
      footer = (
        <Footer
          hint={
            reviewedEnd
              ? null
              : reviewNudge !== null
                ? reviewNudge < 5
                  ? "Scroll through the whole agreement to continue."
                  : `You're ${reviewNudge}% of the way through. Keep scrolling to the end to continue.`
                : "Scroll to the end of the agreement to continue"
          }
          hintTone={reviewNudge !== null && !reviewedEnd ? "error" : "muted"}
          primary={
            <Button
              type="button"
              className={cn("h-12 w-full text-base font-semibold", !reviewedEnd && "opacity-60")}
              aria-disabled={!reviewedEnd}
              onClick={() => {
                if (reviewedEnd) setStep(1);
                else setReviewNudge(readProgress());
              }}
            >
              Continue
            </Button>
          }
        />
      );
    } else if (step === 1) {
      body = (
        <DetailsStep
          form={form}
          errors={errors}
          patch={patch}
          email={ctx.profile.email}
          dobLocked={dobLocked}
          minor={minor}
          payorOn={payorOn}
          setPayorOn={(v) => {
            setPayorOn(v);
            if (!v) setPayorConfirmed(false);
          }}
        />
      );
      footer = (
        <Footer
          problemsTitle="Fill these in to continue"
          problems={describeDetailsErrors(errors)}
          onJump={jumpTo}
          primary={
            <Button
              type="button"
              className="h-12 w-full text-base font-semibold"
              onClick={() => {
                if (validateDetails()) setStep(2);
              }}
            >
              Continue
            </Button>
          }
        />
      );
    } else {
      body = (
        <SignStep
          content={content}
          consents={consents}
          setConsents={setConsents}
          acked={acked}
          setAcked={setAcked}
          payorOn={payorOn}
          payorConfirmed={payorConfirmed}
          setPayorConfirmed={setPayorConfirmed}
          typedName={typedName}
          setTypedName={setTypedName}
          method={method}
          setMethod={setMethod}
          signature={signature}
          setSignature={setSignature}
          minor={minor}
          guardianName={form.guardianName}
          guardianAck={guardianAck}
          setGuardianAck={setGuardianAck}
          guardianMethod={guardianMethod}
          setGuardianMethod={setGuardianMethod}
          guardianSignature={guardianSignature}
          setGuardianSignature={setGuardianSignature}
          offline={!online}
          profileName={ctx.profile.fullName}
          attempted={signAttempted}
          missingKeys={missingKeys}
        />
      );
      const showMissing = signAttempted && missing.length > 0;
      footer = (
        <Footer
          hint={
            !showMissing && missing.length > 0
              ? `${missing.length} ${missing.length === 1 ? "thing" : "things"} left before you can sign`
              : null
          }
          problemsTitle="Before you can sign"
          problems={showMissing ? missing : []}
          onJump={jumpTo}
          primary={
            <Button
              type="button"
              className={cn(
                "h-12 w-full text-base font-semibold",
                missing.length > 0 && !mutation.isPending && "opacity-70",
              )}
              disabled={mutation.isPending}
              aria-disabled={missing.length > 0 || undefined}
              onClick={() => {
                if (mutation.isPending) return;
                if (missing.length > 0) {
                  // Tapping while something is missing shows exactly what, and takes them to it.
                  setSignAttempted(true);
                  jumpTo(missing[0].anchor);
                  return;
                }
                mutation.mutate();
              }}
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing…
                </>
              ) : (
                "Sign agreement"
              )}
            </Button>
          }
        />
      );
    }
  }

  const showStepper = !signed && !!form && !alreadyCurrent && !staleBundle && !!ctx;

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          showBackButton={false}
          className={FULLSCREEN}
          onInteractOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogTitle className="sr-only">Coaching Agreement</DialogTitle>
          <DialogDescription className="sr-only">
            Review and sign your JF Effect Coaching Agreement.
          </DialogDescription>

          <header
            className="shrink-0 border-b border-border bg-background px-3 pb-3 sm:rounded-t-2xl"
            style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
          >
            <div className="flex items-center gap-2">
              {showStepper && step > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 shrink-0"
                  aria-label="Back"
                  onClick={() => setStep((s) => (s > 0 ? ((s - 1) as Step) : s))}
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              ) : (
                <span className="h-11 w-11 shrink-0" />
              )}
              <div className="min-w-0 flex-1 text-center">
                <p className="truncate text-sm font-bold">Coaching Agreement</p>
                {showStepper && (
                  <p className="text-xs text-muted-foreground">
                    Step {step + 1} of 3 · {STEP_TITLES[step]}
                  </p>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-11 shrink-0"
                aria-label="Close"
                disabled={mutation.isPending}
                onClick={close}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            {showStepper && (
              <div className="mt-2 flex gap-1.5 px-2" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-muted"}`}
                  />
                ))}
              </div>
            )}
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
            {body}
          </div>

          {footer}
        </DialogContent>
      </Dialog>

      {signed && (
        <AgreementRecordViewer
          signatureId={signed.signatureId}
          open={viewerOpen}
          onOpenChange={setViewerOpen}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Footer({
  hint,
  hintTone = "muted",
  problems,
  problemsTitle,
  onJump,
  primary,
}: {
  hint?: string | null;
  hintTone?: "muted" | "error";
  problems?: MissingItem[];
  problemsTitle?: string;
  onJump?: (anchor: string) => void;
  primary: ReactNode;
}) {
  return (
    <footer
      className="shrink-0 border-t border-border bg-background px-4 pt-3 sm:rounded-b-2xl"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      {problems && problems.length > 0 && onJump && (
        <MissingPanel title={problemsTitle ?? "Still needed"} items={problems} onJump={onJump} />
      )}
      {hint && (
        <p
          className={cn(
            "mb-2 text-center text-xs",
            hintTone === "error" ? "font-semibold text-destructive" : "text-muted-foreground",
          )}
        >
          {hint}
        </p>
      )}
      {primary}
    </footer>
  );
}

/**
 * Everything still missing, as a short list the client can tap to jump straight to the spot.
 * It stays on screen (it lives in the sticky footer) and shrinks as things get filled in.
 */
function MissingPanel({
  title,
  items,
  onJump,
}: {
  title: string;
  items: MissingItem[];
  onJump: (anchor: string) => void;
}) {
  return (
    <div
      role="alert"
      data-testid="missing-panel"
      className="mb-3 max-h-[36vh] overflow-y-auto rounded-xl border border-destructive/40 bg-destructive/10 p-3 animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
    >
      <p className="flex items-center gap-2 text-sm font-bold text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {title}
      </p>
      <ul className="mt-1.5">
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              onClick={() => onJump(item.anchor)}
              className="flex min-h-[40px] w-full items-center justify-between gap-2 rounded-lg px-2 text-left text-sm font-medium text-foreground active:bg-destructive/10"
            >
              <span>{item.label}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CenteredNote({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title?: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[60%] max-w-sm flex-col items-center justify-center gap-3 py-16 text-center">
      {icon}
      {title && <h2 className="text-lg font-bold">{title}</h2>}
      <p className="text-sm text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}

function SuccessView({
  email,
  onView,
  onDone,
}: {
  email: string;
  onView: () => void;
  onDone: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-[70%] max-w-sm flex-col items-center justify-center gap-4 py-12 text-center">
      <div className="grid h-20 w-20 place-items-center rounded-full bg-emerald-500/15">
        <CheckCircle2 className="h-11 w-11 text-emerald-500" />
      </div>
      <h2 className="text-2xl font-black tracking-tight">You're signed.</h2>
      <p className="text-[15px] leading-snug text-muted-foreground">
        Your signed copy is saved in your account
        {email ? ` and a receipt is on its way to ${email}` : ""}. This agreement now covers every
        service and purchase.
      </p>
      <div className="mt-2 w-full space-y-2">
        <Button type="button" className="h-12 w-full text-base font-semibold" onClick={onDone}>
          Done
        </Button>
        <Button type="button" variant="outline" className="h-12 w-full text-base" onClick={onView}>
          View signed copy
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Find it any time under Account, then Coaching Agreement.
      </p>
    </div>
  );
}

function ReviewStep({
  content,
  title,
  intro,
  note,
  onOpened,
  endRef,
  reviewedEnd,
}: {
  content: AgreementContent;
  title: string;
  intro: string;
  note: string | null;
  onOpened: (n: number) => void;
  endRef: RefObject<HTMLDivElement | null>;
  reviewedEnd: boolean;
}) {
  return (
    <div className="space-y-5 py-4">
      <div className="space-y-1.5">
        <p className="text-xs font-bold uppercase tracking-wider text-primary">
          Version {content.version} · Effective{" "}
          {formatSignedDate(`${content.effectiveDate}T12:00:00Z`)}
        </p>
        <h1 className="text-2xl font-black leading-tight tracking-tight">{title}</h1>
        <p className="text-[15px] leading-snug text-muted-foreground">{intro}</p>
        {note && (
          <blockquote className="rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            {note}
          </blockquote>
        )}
      </div>
      <AgreementReader content={content} onOpenedCount={(n) => onOpened(n)} />
      <div ref={endRef} className="h-px" />
      <p className="pb-2 text-center text-xs text-muted-foreground">
        {reviewedEnd ? "You've reached the end. Tap Continue." : "Keep scrolling to the end."}
      </p>
    </div>
  );
}

function Field({
  label,
  error,
  hint,
  children,
  htmlFor,
  required,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  htmlFor: string;
  required?: boolean;
}) {
  // Give the input the invalid look and the right accessibility flags without repeating
  // them on every field.
  const control = isValidElement<Record<string, unknown>>(children)
    ? cloneElement(children, {
        "aria-invalid": error ? true : undefined,
        "aria-required": required ? true : undefined,
        className: cn(
          children.props.className as string | undefined,
          error && "border-destructive focus-visible:ring-destructive",
        ),
      })
    : children;
  return (
    <div className="space-y-1.5" data-invalid={error ? "true" : undefined}>
      <Label htmlFor={htmlFor} className="text-[13px] font-semibold">
        {label}
        {required && (
          <>
            <span aria-hidden className="ml-0.5 text-destructive">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </Label>
      {control}
      {error ? (
        <p className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

const inputClass = "h-12 text-base";

function DetailsStep({
  form,
  errors,
  patch,
  email,
  dobLocked,
  minor,
  payorOn,
  setPayorOn,
}: {
  form: FormState;
  errors: Record<string, string>;
  patch: (next: Partial<FormState>) => void;
  email: string;
  dobLocked: boolean;
  minor: boolean;
  payorOn: boolean;
  setPayorOn: (v: boolean) => void;
}) {
  const todayIso = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-5 py-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Confirm your details</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          These become part of your signed agreement. Anything already on your profile is filled in.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          <span className="font-bold text-destructive">*</span> Required to continue
        </p>
      </div>

      <section className="space-y-4 rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">You</h2>
        <Field label="Email" htmlFor="ag-email" hint="From your account.">
          <Input id="ag-email" className={inputClass} value={email} disabled readOnly />
        </Field>
        <Field label="Phone" htmlFor="ag-phone" required error={errors["phone"]}>
          <Input
            id="ag-phone"
            className={inputClass}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={form.phone}
            onChange={(e) => patch({ phone: e.target.value })}
            placeholder="204 555 0123"
          />
        </Field>
        <Field
          label="Date of birth"
          htmlFor="ag-dob"
          required={!dobLocked}
          error={errors["dateOfBirth"]}
          hint={
            dobLocked ? "Already on your profile. If it's wrong, message your coach." : undefined
          }
        >
          <Input
            id="ag-dob"
            className={inputClass}
            type="date"
            autoComplete="bday"
            max={todayIso}
            min="1900-01-01"
            value={form.dateOfBirth}
            disabled={dobLocked}
            onChange={(e) => patch({ dateOfBirth: e.target.value })}
          />
        </Field>
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Address
        </h2>
        <Field
          label="Street and unit"
          htmlFor="ag-street"
          required
          error={errors["address.street"]}
        >
          <Input
            id="ag-street"
            className={inputClass}
            autoComplete="address-line1"
            value={form.street}
            onChange={(e) => patch({ street: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City" htmlFor="ag-city" required error={errors["address.city"]}>
            <Input
              id="ag-city"
              className={inputClass}
              autoComplete="address-level2"
              value={form.city}
              onChange={(e) => patch({ city: e.target.value })}
            />
          </Field>
          <Field
            label="Province / state"
            htmlFor="ag-province"
            required
            error={errors["address.province"]}
          >
            <Input
              id="ag-province"
              className={inputClass}
              autoComplete="address-level1"
              value={form.province}
              onChange={(e) => patch({ province: e.target.value })}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Postal / zip code"
            htmlFor="ag-postal"
            required
            error={errors["address.postalCode"]}
          >
            <Input
              id="ag-postal"
              className={inputClass}
              autoComplete="postal-code"
              autoCapitalize="characters"
              value={form.postalCode}
              onChange={(e) => patch({ postalCode: e.target.value })}
            />
          </Field>
          <Field label="Country" htmlFor="ag-country" required error={errors["address.country"]}>
            <Input
              id="ag-country"
              className={inputClass}
              autoComplete="country-name"
              value={form.country}
              onChange={(e) => patch({ country: e.target.value })}
            />
          </Field>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Emergency contacts
        </h2>
        <p className="-mt-2 text-xs text-muted-foreground">
          Only used if there's an emergency. The first is required; a second is optional.
        </p>
        <Field
          label="Contact 1 name"
          htmlFor="ag-ec1n"
          required
          error={errors["emergencyContact1.name"]}
        >
          <Input
            id="ag-ec1n"
            className={inputClass}
            autoComplete="off"
            value={form.ec1Name}
            onChange={(e) => patch({ ec1Name: e.target.value })}
          />
        </Field>
        <Field
          label="Contact 1 phone"
          htmlFor="ag-ec1p"
          required
          error={errors["emergencyContact1.phone"]}
        >
          <Input
            id="ag-ec1p"
            className={inputClass}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={form.ec1Phone}
            onChange={(e) => patch({ ec1Phone: e.target.value })}
          />
        </Field>
        <Field
          label="Contact 2 name (optional)"
          htmlFor="ag-ec2n"
          error={errors["emergencyContact2.name"]}
        >
          <Input
            id="ag-ec2n"
            className={inputClass}
            autoComplete="off"
            value={form.ec2Name}
            onChange={(e) => patch({ ec2Name: e.target.value })}
          />
        </Field>
        <Field
          label="Contact 2 phone (optional)"
          htmlFor="ag-ec2p"
          error={errors["emergencyContact2.phone"]}
        >
          <Input
            id="ag-ec2p"
            className={inputClass}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={form.ec2Phone}
            onChange={(e) => patch({ ec2Phone: e.target.value })}
          />
        </Field>
      </section>

      {minor && (
        <section className="space-y-4 rounded-2xl border-2 border-amber-500/50 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <UserRound className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <h2 className="text-base font-bold">Parent or guardian needed</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Because you're under 18, a parent or legal guardian must sign too. On the last step,
                hand your phone to them.
              </p>
            </div>
          </div>
          <Field
            label="Parent or guardian full name"
            htmlFor="ag-gn"
            required
            error={errors["guardian.fullName"]}
          >
            <Input
              id="ag-gn"
              className={inputClass}
              autoComplete="off"
              value={form.guardianName}
              onChange={(e) => patch({ guardianName: e.target.value })}
            />
          </Field>
          <Field
            label="Relationship to you"
            htmlFor="ag-gr"
            required
            error={errors["guardian.relationship"]}
          >
            <Input
              id="ag-gr"
              className={inputClass}
              autoComplete="off"
              placeholder="Mother, father, legal guardian…"
              value={form.guardianRelationship}
              onChange={(e) => patch({ guardianRelationship: e.target.value })}
            />
          </Field>
          <Field label="Their phone" htmlFor="ag-gp" required error={errors["guardian.phone"]}>
            <Input
              id="ag-gp"
              className={inputClass}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={form.guardianPhone}
              onChange={(e) => patch({ guardianPhone: e.target.value })}
            />
          </Field>
        </section>
      )}

      <section className="space-y-4 rounded-2xl border border-border bg-card p-4">
        <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-4">
          <span className="text-[15px] font-semibold leading-snug">
            Someone else pays for my coaching
          </span>
          <Switch
            checked={payorOn}
            onCheckedChange={setPayorOn}
            aria-label="Someone else pays for my coaching"
          />
        </label>
        {payorOn && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              The person paying becomes responsible for the charges (see Services &amp; Purchases
              Covered). Give them a chance to read this agreement first.
            </p>
            <Field label="Payor full name" htmlFor="ag-pn" required error={errors["payor.name"]}>
              <Input
                id="ag-pn"
                className={inputClass}
                autoComplete="off"
                value={form.payorName}
                onChange={(e) => patch({ payorName: e.target.value })}
              />
            </Field>
            <Field
              label="Relationship to you"
              htmlFor="ag-pr"
              required
              error={errors["payor.relationship"]}
            >
              <Input
                id="ag-pr"
                className={inputClass}
                autoComplete="off"
                value={form.payorRelationship}
                onChange={(e) => patch({ payorRelationship: e.target.value })}
              />
            </Field>
            <Field label="Payor phone" htmlFor="ag-pp" required error={errors["payor.phone"]}>
              <Input
                id="ag-pp"
                className={inputClass}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={form.payorPhone}
                onChange={(e) => patch({ payorPhone: e.target.value })}
              />
            </Field>
            <Field label="Payor email" htmlFor="ag-pe" required error={errors["payor.email"]}>
              <Input
                id="ag-pe"
                className={inputClass}
                type="email"
                inputMode="email"
                autoComplete="off"
                autoCapitalize="none"
                value={form.payorEmail}
                onChange={(e) => patch({ payorEmail: e.target.value })}
              />
            </Field>
          </div>
        )}
      </section>
    </div>
  );
}

function CheckRow({
  checked,
  onChange,
  children,
  id,
  invalid,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  id: string;
  /** Shown after a failed attempt to sign: this one still needs a tick. */
  invalid?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      data-invalid={invalid ? "true" : undefined}
      className={cn(
        "flex min-h-[56px] cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors active:bg-muted/50",
        checked
          ? "border-primary/50 bg-primary/5"
          : invalid
            ? "border-destructive bg-destructive/5"
            : "border-border",
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        aria-invalid={invalid ? true : undefined}
        className={cn("mt-0.5 h-6 w-6 shrink-0 rounded-md", invalid && "border-destructive")}
      />
      <span className="text-[14px] leading-snug text-foreground">
        {children}
        {invalid && (
          <span className="mt-1 block text-xs font-semibold text-destructive">Tick to confirm</span>
        )}
      </span>
    </label>
  );
}

function MethodToggle({ method, onChange }: { method: Method; onChange: (m: Method) => void }) {
  return (
    <div
      className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1"
      role="group"
      aria-label="Signature style"
    >
      {(
        [
          ["drawn", "Draw", PenLine],
          ["typed", "Type instead", Type],
        ] as const
      ).map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-pressed={method === value}
          className={`flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors ${
            method === value ? "bg-background shadow text-foreground" : "text-muted-foreground"
          }`}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  );
}

function TypedPreview({ name }: { name: string }) {
  return (
    <div className="grid h-[120px] place-items-center overflow-hidden rounded-xl border-2 border-dashed border-border bg-white px-4">
      <span
        className="max-w-full truncate text-4xl text-slate-900"
        style={{ fontFamily: '"Snell Roundhand", "Segoe Script", "Brush Script MT", cursive' }}
      >
        {name.trim() || "Your name"}
      </span>
    </div>
  );
}

function SignStep(props: {
  content: AgreementContent;
  consents: Record<string, boolean>;
  setConsents: (c: Record<string, boolean>) => void;
  acked: string[];
  setAcked: (a: string[]) => void;
  payorOn: boolean;
  payorConfirmed: boolean;
  setPayorConfirmed: (v: boolean) => void;
  typedName: string;
  setTypedName: (v: string) => void;
  method: Method;
  setMethod: (m: Method) => void;
  signature: string | null;
  setSignature: (s: string | null) => void;
  minor: boolean;
  guardianName: string;
  guardianAck: boolean;
  setGuardianAck: (v: boolean) => void;
  guardianMethod: Method;
  setGuardianMethod: (m: Method) => void;
  guardianSignature: string | null;
  setGuardianSignature: (s: string | null) => void;
  offline: boolean;
  profileName: string;
  /** True once they've tried to sign; missing things are then marked in red. */
  attempted: boolean;
  missingKeys: ReadonlySet<string>;
}) {
  const { content, acked, setAcked } = props;
  const flag = (key: string) => props.attempted && props.missingKeys.has(key);
  const toggleAck = (id: string, on: boolean) =>
    setAcked(on ? Array.from(new Set([...acked, id])) : acked.filter((x) => x !== id));

  return (
    <div className="space-y-5 py-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Agree &amp; sign</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          Confirm the key points, then sign. This is your legally binding signature.
        </p>
      </div>

      {props.offline && (
        <div
          id="ag-offline"
          className="flex items-center gap-2.5 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
        >
          <WifiOff className="h-4 w-4 shrink-0 text-amber-600" />
          You're offline. Reconnect to sign.
        </div>
      )}

      <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Your permissions (optional)
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Off unless you turn them on. You can change these any time under Account, then Legal
            &amp; Safety.
          </p>
        </div>
        {content.optionalConsents.map((c) => (
          <label
            key={c.key}
            className="flex min-h-[56px] cursor-pointer items-start justify-between gap-4 rounded-xl border border-border p-3.5"
          >
            <span>
              <span className="block text-[15px] font-semibold leading-snug">{c.label}</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">
                {c.text}
              </span>
            </span>
            <Switch
              checked={!!props.consents[c.key]}
              onCheckedChange={(v) => props.setConsents({ ...props.consents, [c.key]: v })}
              aria-label={c.label}
              className="mt-1"
            />
          </label>
        ))}
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Confirm the key points
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="font-bold text-destructive">*</span> All of these are required to sign.
          </p>
        </div>
        {content.acknowledgements.map((a) => (
          <CheckRow
            key={a.id}
            id={`ag-ack-${a.id}`}
            checked={acked.includes(a.id)}
            onChange={(v) => toggleAck(a.id, v)}
            invalid={props.attempted && !acked.includes(a.id)}
          >
            {a.text}
          </CheckRow>
        ))}
        {props.payorOn && (
          <CheckRow
            id="ag-ack-payor"
            checked={props.payorConfirmed}
            onChange={props.setPayorConfirmed}
            invalid={flag("payor")}
          >
            {content.payorStatement}
          </CheckRow>
        )}
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          {props.minor ? "Your name" : "Sign"}
        </h2>
        <div className="space-y-1.5">
          <Label htmlFor="ag-legal-name" className="text-[13px] font-semibold">
            Full legal name
            <span aria-hidden className="ml-0.5 text-destructive">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </Label>
          <Input
            id="ag-legal-name"
            className={cn(
              inputClass,
              flag("name") && "border-destructive focus-visible:ring-destructive",
            )}
            autoComplete="name"
            autoCapitalize="words"
            aria-required
            aria-invalid={flag("name") ? true : undefined}
            value={props.typedName}
            onChange={(e) => props.setTypedName(e.target.value)}
          />
          {flag("name") ? (
            <p className="text-xs font-medium text-destructive" role="alert">
              Type your full legal name (at least 3 characters, with letters).
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Account name: {props.profileName || "not set"}
            </p>
          )}
        </div>

        {!props.minor && (
          <>
            <MethodToggle method={props.method} onChange={props.setMethod} />
            {props.method === "drawn" ? (
              <div id="ag-signature" className="space-y-1.5">
                <SignaturePad
                  onChange={props.setSignature}
                  initialDataUrl={props.signature}
                  invalid={flag("signature")}
                />
                {flag("signature") && (
                  <p className="text-xs font-medium text-destructive" role="alert">
                    Your signature is required. Draw it in the box above.
                  </p>
                )}
              </div>
            ) : (
              <TypedPreview name={props.typedName} />
            )}
          </>
        )}
        <p className="rounded-xl bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
          {content.intentStatement}
        </p>
      </section>

      {props.minor && (
        <section className="space-y-4 rounded-2xl border-2 border-amber-500/50 bg-amber-500/10 p-4">
          <div>
            <h2 className="text-base font-bold">Parent or guardian signs here</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Hand the phone to {props.guardianName.trim() || "your parent or guardian"}.
            </p>
          </div>
          <CheckRow
            id="ag-ack-guardian"
            checked={props.guardianAck}
            onChange={props.setGuardianAck}
            invalid={flag("guardian-ack")}
          >
            {content.guardianStatement}
          </CheckRow>
          <MethodToggle method={props.guardianMethod} onChange={props.setGuardianMethod} />
          <div id="ag-guardian-signature" className="space-y-1.5">
            {props.guardianMethod === "drawn" ? (
              <>
                <SignaturePad
                  onChange={props.setGuardianSignature}
                  initialDataUrl={props.guardianSignature}
                  ariaLabel="Parent or guardian signature"
                  invalid={flag("guardian-signature")}
                />
                {flag("guardian-signature") && (
                  <p className="text-xs font-medium text-destructive" role="alert">
                    The parent or guardian's signature is required. Draw it in the box above.
                  </p>
                )}
              </>
            ) : (
              <TypedPreview name={props.guardianName} />
            )}
          </div>
        </section>
      )}
    </div>
  );
}
