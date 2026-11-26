import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, Loader2, Mail, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { roleRequiresMfa, verifiedFactorCount } from "@/lib/mfa-rules";
import { confirmWithTrustedDevice, setTwoStepPreferred } from "@/lib/two-step.functions";
import {
  isTeamRole,
  KIND_TITLE,
  kindsInOrder,
  needsFasterWay,
  orderMethods,
  twoStepGateStep,
  type TwoStepKind,
  type TwoStepStatus,
} from "@/lib/two-step";
import {
  clearTrust,
  fasterOfferSnoozed,
  forgetConfirmed,
  passkeysPossibleHere,
  passkeyTitleHere,
  readTrust,
  rememberConfirmed,
  saveTrust,
  snoozeFasterOffer,
  trustByDefault,
  wasConfirmedHere,
} from "@/lib/two-step-client";
import {
  AddWay,
  KIND_ICON,
  PasskeyConfirm,
  SmsCodeStep,
  TotpConfirm,
  TrustToggle,
  useAddableKinds,
  WayChoices,
  type Confirmed,
} from "@/components/two-step/two-step-flows";
import { useTwoStepStatus } from "@/components/two-step/use-two-step-status";

/**
 * Two-step sign-in (mfa-rules.ts, two-step.ts), over every signed-in page.
 *
 * A client or member passes straight through with no request. A team login
 * asks the server whether this session is confirmed, except when this device
 * already confirmed it (the app opens at once and the server is asked in the
 * background). An unconfirmed session first tries this device's trusted token
 * ("Don't ask again", 30 days), then shows one screen: the way they chose
 * first (Face ID, a texted code or the authenticator app) and "Other ways"
 * for the rest, with "Email me a code" last while the email backup is ready
 * (first, when nothing else works on this device). A login that needs
 * two-step and has none sets one up and goes straight in. There are no
 * recovery codes: a lost phone is an emailed code, another way on another
 * device, the same number on a new phone, or the owner's reset on Team.
 * Confirming with
 * only the authenticator app offers Face ID or a text right then ("Skip the
 * code next time"), so nobody has to find it in Account.
 *
 * Nothing behind it renders until then; the server and the database would
 * refuse it anyway, whatever this screen shows.
 */
export function StaffMfaGate({ children }: { children: ReactNode }) {
  const { session, accountRole, user } = useAuth();
  const qc = useQueryClient();
  const team = isTeamRole(accountRole);
  const required = roleRequiresMfa(accountRole);
  const totp = verifiedFactorCount(session?.user as any);
  const status = useTwoStepStatus(!!session && (team || totp > 0));
  const { uid, sid, aal } = status;

  // Confirmed in this tab a moment ago (before the status catches up).
  const [confirmedSid, setConfirmedSid] = useState<string | null>(null);
  // Setup couldn't start at all: let them in this once (nothing is enforced until a way exists).
  const [deferredFor, setDeferredFor] = useState<string | null>(null);
  // Confirmed with only the authenticator app: offer a faster way before the app.
  const [offerFor, setOfferFor] = useState<string | null>(null);

  const remembered = wasConfirmedHere(sid);
  const step = twoStepGateStep({
    team,
    required,
    aal,
    verifiedFactors: totp,
    rememberedVerified: remembered || (!!sid && confirmedSid === sid),
    status: status.data ?? null,
  });

  useEffect(() => {
    if (status.data?.verified && status.data.methods.length) rememberConfirmed(sid);
    else if (status.data && !status.data.verified) forgetConfirmed(sid);
  }, [status.data, sid]);

  async function onConfirmed(c: Confirmed) {
    if (uid && c.trust) saveTrust(uid, c.trust);
    rememberConfirmed(sid);
    setConfirmedSid(sid);
    // Anything asked for with the unconfirmed session was refused: ask again.
    await qc.invalidateQueries();
  }

  if (!session || !uid) return <>{children}</>;
  if (offerFor === uid && status.data) {
    return (
      <FasterWayScreen
        uid={uid}
        status={status.data}
        email={user?.email}
        onDone={async () => {
          setOfferFor(null);
          await status.refetch();
        }}
      />
    );
  }
  if (step === "pass" || deferredFor === uid) return <>{children}</>;
  if (step === "check") {
    return status.isError ? (
      <GateCard title="Couldn't check your sign-in" email={user?.email}>
        <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
        <Button className="h-12 w-full" onClick={() => void status.refetch()}>
          Try again
        </Button>
        <SignOutButton />
      </GateCard>
    ) : (
      <Splash />
    );
  }
  if (step === "enroll") {
    return (
      <EnrollScreen
        status={status.data!}
        email={user?.email}
        onAdded={async (c) => {
          await onConfirmed(c);
          await status.refetch();
        }}
        onCantSetUp={() => setDeferredFor(uid)}
      />
    );
  }
  return (
    <ConfirmScreen
      key={sid ?? "session"}
      uid={uid}
      status={status.data!}
      email={user?.email}
      onConfirmed={async (c) => {
        const methods = status.data?.methods ?? [];
        if (needsFasterWay(methods, passkeysPossibleHere()) && !fasterOfferSnoozed(uid)) {
          setOfferFor(uid);
        }
        await onConfirmed(c);
      }}
    />
  );
}

function Splash() {
  return (
    <div
      className="grid min-h-[100dvh] place-items-center bg-background"
      aria-busy="true"
      data-two-step-gate="checking"
    >
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function GateCard({
  title,
  email,
  children,
  wide,
}: {
  title: string;
  email?: string | null;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex min-h-[100dvh] items-start justify-center bg-background px-4 pb-8 pt-[max(env(safe-area-inset-top),2.5rem)] sm:items-center sm:pt-8">
      <Card className={`w-full ${wide ? "max-w-lg" : "max-w-md"} space-y-5 rounded-2xl p-5 sm:p-6`}>
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{title}</h1>
            {email && <p className="truncate text-sm text-muted-foreground">{email}</p>}
          </div>
        </div>
        {children}
      </Card>
    </div>
  );
}

function SignOutButton() {
  const { signOut } = useAuth();
  return (
    <Button
      variant="ghost"
      className="h-10 w-full text-muted-foreground"
      onClick={() => void signOut()}
    >
      Sign out
    </Button>
  );
}

/** A way on the confirm screen: one of theirs, or the emailed code (the backup). */
type ConfirmKind = TwoStepKind | "email";

const KIND_NAME = (k: ConfirmKind) =>
  k === "passkey"
    ? passkeyTitleHere()
    : k === "sms"
      ? "Text me a code"
      : k === "email"
        ? "Email me a code"
        : "Authenticator app";

const CONFIRM_ICON = (k: ConfirmKind) => (k === "email" ? Mail : KIND_ICON[k]);

// ── Confirm it's you ────────────────────────────────────────────────────────
function ConfirmScreen({
  uid,
  status,
  email,
  onConfirmed,
}: {
  uid: string;
  status: TwoStepStatus;
  email?: string | null;
  onConfirmed: (c: Confirmed) => Promise<void>;
}) {
  const confirmDevice = useServerFn(confirmWithTrustedDevice);
  const passkeyHere = passkeysPossibleHere();
  const ordered = useMemo(
    () => orderMethods(status.methods, status.preferred, passkeyHere),
    [status, passkeyHere],
  );
  const emailBackup = status.emailBackup?.ready ? status.emailBackup : null;
  const kinds = useMemo<ConfirmKind[]>(
    () => [...kindsInOrder(ordered), ...(emailBackup ? (["email"] as const) : [])],
    [ordered, emailBackup],
  );
  const [kind, setKind] = useState<ConfirmKind | null>(kinds[0] ?? null);
  const [others, setOthers] = useState(false);
  const [trust, setTrust] = useState(() => trustByDefault());
  // This device was trusted: try it before showing anything.
  const [tryingDevice, setTryingDevice] = useState(() => !!readTrust(uid));
  const tried = useRef(false);

  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    const t = readTrust(uid);
    if (!t) return;
    confirmDevice({ data: { token: t.token } })
      .then(async (r) => {
        if (r.ok) {
          await onConfirmed({ trust: null });
          return;
        }
        clearTrust(uid);
        setTryingDevice(false);
      })
      .catch(() => setTryingDevice(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  if (tryingDevice) {
    return (
      <GateCard title="Checking this device" email={email}>
        <div className="grid h-20 place-items-center" aria-busy="true" data-two-step-gate="device">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </GateCard>
    );
  }

  const sms = ordered.find((m) => m.kind === "sms");
  const rest = kinds.filter((k) => k !== kind);

  return (
    <div data-two-step-gate="verify">
      <GateCard title="Confirm it's you" email={email}>
        {kind === "passkey" && <PasskeyConfirm trust={trust} onConfirmed={onConfirmed} />}
        {kind === "sms" && sms && (
          <SmsCodeStep
            key={sms.id}
            purpose="sign_in"
            methodId={sms.id}
            to={sms.label.replace(/^Text to /, "")}
            trust={trust}
            onConfirmed={onConfirmed}
          />
        )}
        {kind === "email" && emailBackup && (
          <SmsCodeStep
            key="email"
            channel="email"
            purpose="sign_in"
            to={emailBackup.to}
            trust={trust}
            onConfirmed={onConfirmed}
          />
        )}
        {kind === "totp" && <TotpConfirm trust={trust} onConfirmed={onConfirmed} />}
        {kind === "totp" && needsFasterWay(status.methods, passkeyHere) && (
          <p className="text-xs text-muted-foreground" data-two-step-faster-hint>
            After this you can switch to{" "}
            {passkeyHere ? `${passkeyTitleHere()} or a text message` : "a text message"}, so you
            won't need the app.
          </p>
        )}
        {!kind && (
          <p className="text-sm text-muted-foreground">
            Face ID works on jfeffect.com in Safari, not in the app. Open the site there to sign in.
          </p>
        )}

        {kind && <TrustToggle checked={trust} onChange={setTrust} />}

        {rest.length > 0 && (
          <div className="border-t pt-3">
            <button
              type="button"
              className="flex h-11 w-full items-center justify-between text-sm font-medium"
              onClick={() => setOthers((v) => !v)}
              aria-expanded={others}
              data-two-step-other-ways
            >
              Other ways to confirm
              <ChevronDown
                className={`h-4 w-4 transition ${others ? "rotate-180" : ""}`}
                aria-hidden
              />
            </button>
            {others && (
              <div className="mt-1 space-y-1">
                {rest.map((k) => {
                  const Icon = CONFIRM_ICON(k);
                  return (
                    <Button
                      key={k}
                      variant="ghost"
                      className="h-11 w-full justify-start"
                      onClick={() => {
                        setKind(k);
                        setOthers(false);
                      }}
                    >
                      <Icon className="mr-2.5 h-4 w-4" /> {KIND_NAME(k)}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <SignOutButton />
      </GateCard>
    </div>
  );
}

// ── First setup ─────────────────────────────────────────────────────────────
function EnrollScreen({
  status,
  email,
  onAdded,
  onCantSetUp,
}: {
  status: TwoStepStatus;
  email?: string | null;
  onAdded: (c: Confirmed) => Promise<void>;
  onCantSetUp: () => void;
}) {
  const { kinds, ready } = useAddableKinds();
  const [kind, setKind] = useState<TwoStepKind | null>(null);
  const [trust, setTrust] = useState(() => trustByDefault());
  return (
    <div data-two-step-gate="enroll">
      <GateCard title={kind ? "Set up two-step sign-in" : "Protect your login"} email={email}>
        {!kind ? (
          <>
            <p className="text-sm text-muted-foreground">
              Your login can see clients' records and the business's money, so after your password
              you'll confirm it's you. Pick how. You can add more ways later in Account.
            </p>
            {ready ? (
              <WayChoices kinds={kinds} onPick={setKind} />
            ) : (
              <div className="h-40" aria-busy="true" />
            )}
          </>
        ) : (
          <>
            <AddWay
              kind={kind}
              suggestedPhone={status.suggestedPhone}
              trust={trust}
              onAdded={async (c) => {
                toast.success("Two-step sign-in is on");
                await onAdded(c);
              }}
              onCantStart={onCantSetUp}
            />
            <TrustToggle checked={trust} onChange={setTrust} />
            <Button variant="ghost" className="h-10 w-full" onClick={() => setKind(null)}>
              Choose another way
            </Button>
          </>
        )}
        <SignOutButton />
      </GateCard>
    </div>
  );
}

// ── Skip the code next time ─────────────────────────────────────────────────
/**
 * Right after confirming with only the authenticator app: add Face ID (where
 * this device has it) or a text, made the way asked first, then into the app.
 * "Not now" keeps it away on this device for 14 days.
 */
function FasterWayScreen({
  uid,
  status,
  email,
  onDone,
}: {
  uid: string;
  status: TwoStepStatus;
  email?: string | null;
  onDone: () => Promise<void>;
}) {
  const prefer = useServerFn(setTwoStepPreferred);
  const { kinds, ready } = useAddableKinds();
  const offer = kinds.filter((k) => k !== "totp");
  const [adding, setAdding] = useState<TwoStepKind | null>(null);
  const passkeyHere = offer.includes("passkey");

  return (
    <div data-two-step-gate="faster">
      <GateCard title="Skip the code next time" email={email}>
        {adding ? (
          <div className="space-y-3">
            <AddWay
              kind={adding}
              suggestedPhone={status.suggestedPhone}
              trust={false}
              onAdded={async () => {
                await prefer({ data: { kind: adding } }).catch(() => undefined);
                toast.success(`${KIND_TITLE[adding]} is on. We'll ask for it next time.`);
                await onDone();
              }}
            />
            <Button variant="ghost" className="h-10 w-full" onClick={() => setAdding(null)}>
              Back
            </Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {passkeyHere
                ? `Add ${passkeyTitleHere()} or a text message. Next time you sign in it's one tap or a texted code, no authenticator app.`
                : "Add a text message. Next time you sign in we text you a code, no authenticator app."}
            </p>
            {ready ? (
              <WayChoices
                kinds={offer}
                have={status.methods.map((m) => m.kind)}
                onPick={setAdding}
              />
            ) : (
              <div className="grid h-20 place-items-center" aria-busy="true">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            <Button
              variant="ghost"
              className="h-11 w-full text-muted-foreground"
              data-two-step-not-now
              onClick={() => {
                snoozeFasterOffer(uid);
                void onDone();
              }}
            >
              Not now
            </Button>
          </>
        )}
      </GateCard>
    </div>
  );
}

// ── Confirming again for one sensitive action (step-up) ─────────────────────
/**
 * "Confirm it's you" for one sensitive action, inside a dialog: the sign-in's own ways (Face ID,
 * a text, the authenticator, the emailed backup), never a trusted device (that would skip the
 * question being asked). Confirming marks this session confirmed again, which is what the server
 * checks (two_step_sessions.verified_at).
 */
export function StepUpConfirm({ onConfirmed }: { onConfirmed: () => void | Promise<void> }) {
  const status = useTwoStepStatus(true);
  const passkeyHere = passkeysPossibleHere();
  const data = status.data;
  const ordered = useMemo(
    () => (data ? orderMethods(data.methods, data.preferred, passkeyHere) : []),
    [data, passkeyHere],
  );
  const emailBackup = data?.emailBackup?.ready ? data.emailBackup : null;
  const kinds = useMemo<ConfirmKind[]>(
    () => [...kindsInOrder(ordered), ...(emailBackup ? (["email"] as const) : [])],
    [ordered, emailBackup],
  );
  const [picked, setPicked] = useState<ConfirmKind | null>(null);
  const kind = picked ?? kinds[0] ?? null;
  const done = async () => {
    rememberConfirmed(status.sid);
    await onConfirmed();
  };
  if (status.isLoading || !data) {
    return (
      <div className="grid h-20 place-items-center" aria-busy="true">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  const sms = ordered.find((m) => m.kind === "sms");
  return (
    <div className="space-y-4" data-step-up>
      {kind === "passkey" && <PasskeyConfirm trust={false} onConfirmed={done} />}
      {kind === "sms" && sms && (
        <SmsCodeStep key={sms.id} purpose="sign_in" methodId={sms.id} to={sms.label.replace(/^Text to /, "")} trust={false} onConfirmed={done} />
      )}
      {kind === "email" && emailBackup && (
        <SmsCodeStep key="email" channel="email" purpose="sign_in" to={emailBackup.to} trust={false} onConfirmed={done} />
      )}
      {kind === "totp" && <TotpConfirm trust={false} onConfirmed={done} />}
      {!kind && <p className="text-sm text-muted-foreground">No way to confirm is set up on this sign-in.</p>}
      {kinds.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-t pt-3">
          {kinds
            .filter((k) => k !== kind)
            .map((k) => {
              const Icon = CONFIRM_ICON(k);
              return (
                <Button key={k} variant="ghost" size="sm" className="h-10" onClick={() => setPicked(k)}>
                  <Icon className="mr-2 h-4 w-4" /> {KIND_NAME(k)}
                </Button>
              );
            })}
        </div>
      )}
    </div>
  );
}
