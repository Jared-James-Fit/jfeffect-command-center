import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Laptop, Loader2, Mail, MoreHorizontal, Plus, ShieldCheck, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";
import { billingDay } from "@/lib/date-range";
import {
  emailBackupLine,
  emailBackupSwitchOn,
  KIND_TITLE,
  leavesOnlyPasskeys,
  type EmailBackup,
  type TwoStepKind,
  type TwoStepMethod,
  type TwoStepStatus,
} from "@/lib/two-step";
import {
  forgetTwoStepDevice,
  listTwoStepDevices,
  removeTwoStepMethod,
  setTwoStepEmailBackup,
  setTwoStepPreferred,
  trustThisDevice,
  type TrustedDeviceRow,
} from "@/lib/two-step.functions";
import { clearTrust, deviceNameHere, readTrust, saveTrust } from "@/lib/two-step-client";
import {
  AddWay,
  KIND_ICON,
  useAddableKinds,
  WayChoices,
} from "@/components/two-step/two-step-flows";
import { TWO_STEP_STATUS_KEY, useTwoStepStatus } from "@/components/two-step/use-two-step-status";

const DEVICES_KEY = "two-step-devices";

function day(iso: string | null | undefined): string {
  return (iso ? billingDay(iso.slice(0, 10)) : "") ?? "";
}

/**
 * A login's ways to confirm it's them (two-step.ts): Face ID / Touch ID, text
 * messages, authenticator apps. Which is asked first, add one, remove one
 * (never the last while the login needs two-step). Used on Account.
 */
export function TwoStepMethodList({
  status,
  onChanged,
}: {
  status: TwoStepStatus;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const remove = useServerFn(removeTwoStepMethod);
  const prefer = useServerFn(setTwoStepPreferred);
  const { kinds, ready } = useAddableKinds();
  const [adding, setAdding] = useState<TwoStepKind | "choose" | null>(null);
  const [removing, setRemoving] = useState<TwoStepMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const methods = status.methods;
  const lastOne = status.required && methods.length <= 1;

  async function refresh() {
    await qc.invalidateQueries({ queryKey: [TWO_STEP_STATUS_KEY] });
    onChanged();
  }

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    try {
      await remove({ data: { kind: removing.kind, id: removing.id } });
      toast.success(`${KIND_TITLE[removing.kind]} removed`);
      setRemoving(null);
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't remove it. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function askFirst(k: TwoStepKind) {
    try {
      await prefer({ data: { kind: k } });
      toast.success("We'll ask for that first");
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save that.");
    }
  }

  return (
    <div className="space-y-3" data-two-step-methods>
      {methods.length > 0 ? (
        <ul className="divide-y rounded-xl border">
          {methods.map((m) => {
            const Icon = KIND_ICON[m.kind];
            const first =
              m.kind === status.preferred && methods.find((x) => x.kind === m.kind)?.id === m.id;
            return (
              <li
                key={`${m.kind}:${m.id}`}
                className="flex items-center gap-3 px-3 py-2.5"
                data-two-step-method={m.kind}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{m.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {first
                      ? "Asked for first"
                      : m.lastUsedAt
                        ? `Last used ${day(m.lastUsedAt)}`
                        : m.createdAt
                          ? `Added ${day(m.createdAt)}`
                          : KIND_TITLE[m.kind]}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10"
                      aria-label={`Options for ${m.label}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {m.kind !== status.preferred && (
                      <DropdownMenuItem onSelect={() => void askFirst(m.kind)}>
                        Ask for this first
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      disabled={lastOne}
                      onSelect={() => setRemoving(m)}
                      className="text-destructive focus:text-destructive"
                    >
                      {lastOne ? "Remove (add another way first)" : "Remove"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
          No way to confirm yet. Add one.
        </p>
      )}

      <Button
        variant="outline"
        className="h-11 w-full"
        onClick={() => setAdding("choose")}
        disabled={!ready}
      >
        <Plus className="mr-1.5 h-4 w-4" /> Add a way to confirm
      </Button>

      <Sheet open={!!adding} onOpenChange={(o) => !o && setAdding(null)}>
        <SheetContent
          side="bottom"
          swipeToClose
          hideCloseButton
          className="max-h-[92dvh] overflow-y-auto rounded-t-[24px] p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:mx-auto sm:max-w-[480px]"
        >
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted" aria-hidden />
          <SheetHeader className="mb-3 text-left">
            <SheetTitle>
              {adding === "choose" || !adding ? "Add a way to confirm" : KIND_TITLE[adding]}
            </SheetTitle>
            <SheetDescription>
              After your password, any of your ways confirms it's you.
            </SheetDescription>
          </SheetHeader>
          {adding === "choose" ? (
            <WayChoices kinds={kinds} have={methods.map((m) => m.kind)} onPick={setAdding} />
          ) : adding ? (
            <div className="space-y-3">
              <AddWay
                kind={adding}
                suggestedPhone={status.suggestedPhone}
                trust={false}
                onAdded={async () => {
                  toast.success(`${KIND_TITLE[adding]} added`);
                  setAdding(null);
                  await refresh();
                }}
              />
              <Button variant="ghost" className="h-10 w-full" onClick={() => setAdding("choose")}>
                Back
              </Button>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops working for JF Effect.{" "}
              {methods.length > 1
                ? "Your other ways still work."
                : "You won't be asked to confirm any more."}
              {removing && leavesOnlyPasskeys(methods, removing) && (
                <span className="mt-2 block" data-two-step-passkey-only-warning>
                  Only Face ID or Touch ID would be left, and the iPhone and Android apps can't use
                  it. Keep a text message so you can sign in there.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmRemove();
              }}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * "Email me a code": the backup for when they don't have their phone. On by
 * default once a login has a way; it sends only to the login's own email.
 */
function EmailBackupRow({ backup, onChanged }: { backup: EmailBackup; onChanged: () => void }) {
  const qc = useQueryClient();
  const save = useServerFn(setTwoStepEmailBackup);
  const [busy, setBusy] = useState(false);
  const on = emailBackupSwitchOn(backup);

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      await save({ data: { on: next } });
      toast.success(next ? "Codes can be emailed to you" : "Email codes are off");
      await qc.invalidateQueries({ queryKey: [TWO_STEP_STATUS_KEY] });
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex items-center gap-3 rounded-xl border px-3 py-2.5"
      data-two-step-email-backup={on ? "on" : "off"}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted">
        <Mail className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          Email me a code{on && backup.to ? ` · ${backup.to}` : ""}
        </span>
        <span className="block text-xs text-muted-foreground">{emailBackupLine(backup, day)}</span>
      </span>
      <Switch
        checked={on}
        disabled={busy}
        onCheckedChange={(v) => void toggle(v === true)}
        aria-label="Email me a code"
      />
    </div>
  );
}

/** Devices that skip the second step for 30 days. */
function TrustedDevices({ uid }: { uid: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listTwoStepDevices);
  const forget = useServerFn(forgetTwoStepDevice);
  const trust = useServerFn(trustThisDevice);
  const { data: devices, isLoading } = useQuery({
    queryKey: [DEVICES_KEY, uid],
    queryFn: () => list({}),
    staleTime: 30_000,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const mine = readTrust(uid);
  const here = devices?.find((d) => d.id === mine?.id);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: [DEVICES_KEY, uid] });
    } catch (e: any) {
      toast.error(e?.message ?? "That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const row = (d: TrustedDeviceRow) => (
    <li key={d.id} className="flex items-center gap-3 px-3 py-2.5" data-two-step-device>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted">
        {/phone|iPad|tablet/i.test(d.label) ? (
          <Smartphone className="h-4 w-4" aria-hidden />
        ) : (
          <Laptop className="h-4 w-4" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {d.label}
          {d.id === mine?.id && (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">· This device</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">Trusted until {day(d.expiresAt)}</div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-10"
        disabled={!!busy}
        onClick={() =>
          void run(d.id, async () => {
            await forget({ data: { id: d.id } });
            if (d.id === mine?.id) clearTrust(uid);
            toast.success("Device forgotten");
          })
        }
      >
        {busy === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Forget"}
      </Button>
    </li>
  );

  return (
    <div className="space-y-3 rounded-xl border p-3" data-two-step-devices>
      <div>
        <div className="text-sm font-medium">Trusted devices</div>
        <div className="text-xs text-muted-foreground">
          These skip the second step for 30 days. Your password is still asked.
        </div>
      </div>
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : devices && devices.length ? (
        <ul className="divide-y rounded-lg border">{devices.map(row)}</ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          None. Tick "Don't ask again on this device" when you sign in.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!here && (
          <Button
            variant="outline"
            size="sm"
            className="h-10"
            disabled={!!busy}
            onClick={() =>
              void run("trust", async () => {
                const t = await trust({ data: { label: deviceNameHere() } });
                saveTrust(uid, t);
                toast.success("This device is trusted for 30 days");
              })
            }
          >
            Trust this device
          </Button>
        )}
        {!!devices?.length && (
          <Button
            variant="ghost"
            size="sm"
            className="h-10"
            disabled={!!busy}
            onClick={() =>
              void run("all", async () => {
                await forget({ data: { id: null } });
                clearTrust(uid);
                toast.success("Every device forgotten");
              })
            }
          >
            Forget all
          </Button>
        )}
      </div>
    </div>
  );
}

/** Account → Two-step sign-in. */
export function TwoStepCard() {
  const status = useTwoStepStatus();
  const data = status.data;
  const has = (data?.methods.length ?? 0) > 0;

  return (
    <Card className="space-y-4 rounded-2xl p-5 sm:p-6" data-two-step-card>
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4" aria-hidden />
        <h3 className="text-base font-semibold">Two-step sign-in</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        After your password you confirm it's you with one of these. Face ID and a text are easiest.
        Without your phone, a code can be emailed to you.
      </p>

      {status.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      {status.error && (
        <p className="text-sm text-destructive">
          {(status.error as any)?.message ?? "Couldn't load two-step sign-in."}
        </p>
      )}

      {data && <TwoStepMethodList status={data} onChanged={() => void status.refetch()} />}
      {has && data?.emailBackup && (
        <EmailBackupRow backup={data.emailBackup} onChanged={() => void status.refetch()} />
      )}
      {data && data.methods.length > 0 && data.methods.every((m) => m.kind === "passkey") && (
        <p className="text-xs text-muted-foreground" data-two-step-passkey-only>
          Add a text message too: Face ID works on jfeffect.com, not in the iPhone or Android app.
        </p>
      )}

      {has && status.uid && <TrustedDevices uid={status.uid} />}
    </Card>
  );
}
