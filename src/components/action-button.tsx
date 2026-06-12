import * as React from "react";
import { Loader2, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { jobStore } from "@/lib/progress-jobs";

/**
 * Action state machine used by both <ActionButton> and the useAction() hook.
 * idle → pending → success | error → (auto-resets to idle)
 */
export type ActionState = "idle" | "pending" | "success" | "error";

export interface ActionButtonProps extends Omit<ButtonProps, "onClick"> {
  /** Async handler. While pending, the button is disabled and shows the loading label. */
  onAction?: (event: React.MouseEvent<HTMLButtonElement>) => unknown | Promise<unknown>;
  /** Default label / children when idle. */
  children: React.ReactNode;
  /** Label shown while the action is pending. Defaults to children. */
  loadingLabel?: React.ReactNode;
  /** Label shown briefly on success. If omitted, returns to default. */
  successLabel?: React.ReactNode;
  /** Label shown briefly on error. If omitted, returns to default. */
  errorLabel?: React.ReactNode;
  /** Optional icon to render to the left of the label when idle. */
  icon?: React.ReactNode;
  /** Optional toasts on success / error. Pass `false` to suppress that toast. */
  successToast?: string | false;
  /** Pass a string for a custom error toast, false to suppress, true (default) to surface the thrown message. */
  errorToast?: string | boolean;
  /** ms to show success / error state before resetting. Default 1600. */
  resetMs?: number;
  /** If true, do not show the spinner (only the loading label). Default false. */
  hideSpinner?: boolean;
  /** External state override — useful when the action is owned by a parent (e.g. autosave + manual save). */
  state?: ActionState;
  /**
   * Opt the action into the global progress drawer.
   * Pass a short title (e.g. "Saving client settings") and the button will
   * push a pending → success/error entry the user can see app-wide.
   * Use for actions that may take more than ~500ms or that the user might
   * navigate away from before completion.
   */
  jobLabel?: string;
  /** Optional sub-line shown in the drawer entry (client name, file name, etc.). */
  jobDescription?: string;
}

/**
 * Drop-in replacement for <Button> that gives instant tap feedback,
 * prevents double-submits, and shows loading / success / error state.
 *
 * ```tsx
 * <ActionButton onAction={save} loadingLabel="Saving…" successLabel="Saved">
 *   Save changes
 * </ActionButton>
 * ```
 */
export const ActionButton = React.forwardRef<HTMLButtonElement, ActionButtonProps>(
  function ActionButton(
    {
      onAction,
      children,
      loadingLabel,
      successLabel,
      errorLabel,
      icon,
      successToast,
      errorToast = true,
      resetMs = 1600,
      hideSpinner = false,
      disabled,
      className,
      state: stateProp,
      type = "button",
      jobLabel,
      jobDescription,
      ...rest
    },
    ref,
  ) {
    const [innerState, setInnerState] = React.useState<ActionState>("idle");
    const state = stateProp ?? innerState;
    const isPending = state === "pending";
    const mountedRef = React.useRef(true);
    const inflightRef = React.useRef(false);
    const resetTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(
      () => () => {
        mountedRef.current = false;
        if (resetTimer.current) clearTimeout(resetTimer.current);
      },
      [],
    );

    const scheduleReset = React.useCallback(() => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => {
        if (mountedRef.current) setInnerState("idle");
      }, resetMs);
    }, [resetMs]);

    const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!onAction) return;
      if (inflightRef.current || isPending) {
        event.preventDefault();
        return;
      }
      inflightRef.current = true;
      setInnerState("pending");
      const handle = jobLabel
        ? jobStore.start({ title: jobLabel, description: jobDescription ?? null, statusText: "Working…" })
        : null;
      try {
        await onAction(event);
        if (!mountedRef.current) return;
        setInnerState("success");
        if (successToast) toast.success(successToast);
        if (handle) jobStore.succeed(handle.id);
        scheduleReset();
      } catch (err: any) {
        if (!mountedRef.current) return;
        setInnerState("error");
        if (handle) jobStore.fail(handle.id, err);
        if (errorToast !== false) {
          const msg =
            typeof errorToast === "string"
              ? errorToast
              : err?.message || "Something went wrong";
          toast.error(msg);
        }
        scheduleReset();
      } finally {
        inflightRef.current = false;
      }
    };

    const label =
      state === "pending"
        ? (loadingLabel ?? children)
        : state === "success" && successLabel
        ? successLabel
        : state === "error" && errorLabel
        ? errorLabel
        : children;

    const StateIcon =
      state === "pending"
        ? hideSpinner ? null : Loader2
        : state === "success" && successLabel
        ? Check
        : state === "error" && errorLabel
        ? AlertTriangle
        : null;

    return (
      <Button
        ref={ref}
        type={type}
        disabled={disabled || isPending}
        onClick={handleClick}
        className={cn(
          "relative transition-transform active:scale-[0.97]",
          state === "success" && !successLabel && "ring-1 ring-success/60",
          className,
        )}
        aria-busy={isPending || undefined}
        aria-live="polite"
        {...rest}
      >
        {StateIcon ? (
          <StateIcon className={cn("h-4 w-4", state === "pending" && "animate-spin")} />
        ) : (
          icon ?? null
        )}
        <span>{label}</span>
      </Button>
    );
  },
);

/* -------------------------------------------------------------------------- */
/* useAction — for cases where the trigger isn't a <button> (links, icons,    */
/* custom UI, dialogs that need shared pending state).                         */
/* -------------------------------------------------------------------------- */

export interface UseActionOptions {
  successToast?: string | false;
  errorToast?: string | boolean;
  resetMs?: number;
}

export function useAction<TArgs extends any[], TResult>(
  fn: (...args: TArgs) => Promise<TResult> | TResult,
  opts: UseActionOptions = {},
) {
  const { successToast, errorToast = true, resetMs = 1600 } = opts;
  const [state, setState] = React.useState<ActionState>("idle");
  const inflightRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  const resetTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      mountedRef.current = false;
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const scheduleReset = React.useCallback(() => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => {
      if (mountedRef.current) setState("idle");
    }, resetMs);
  }, [resetMs]);

  const run = React.useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      if (inflightRef.current) return undefined;
      inflightRef.current = true;
      setState("pending");
      try {
        const result = await fn(...args);
        if (mountedRef.current) {
          setState("success");
          if (successToast) toast.success(successToast);
          scheduleReset();
        }
        return result;
      } catch (err: any) {
        if (mountedRef.current) {
          setState("error");
          if (errorToast !== false) {
            const msg =
              typeof errorToast === "string"
                ? errorToast
                : err?.message || "Something went wrong";
            toast.error(msg);
          }
          scheduleReset();
        }
        throw err;
      } finally {
        inflightRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn, successToast, errorToast, scheduleReset],
  );

  return { run, state, isPending: state === "pending", reset: () => setState("idle") };
}