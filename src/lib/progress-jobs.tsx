import * as React from "react";

/**
 * Global, app-wide progress + confirmation system.
 *
 * Every long-running or important action (assign, upload, send, sync, publish,
 * bulk action, etc.) should route through `runJob()` so the user gets:
 *   - immediate "starting" feedback
 *   - live progress (determinate when bytes/steps are known, indeterminate otherwise)
 *   - step labels for multi-step flows
 *   - success / failure confirmation
 *   - one-click Retry on failure
 *
 * UI surface: <ProgressDrawer /> (mounted once in the root layout). Quick
 * button-level feedback still flows through <ActionButton>; both can fire on
 * the same action — ActionButton pushes job events automatically when given
 * a `jobLabel`.
 */

export type JobStatus = "pending" | "success" | "error";

export type JobStep = { label: string; done: boolean };

export type Job = {
  id: string;
  /** Short title shown in the drawer row (e.g. "Assign workout program"). */
  title: string;
  /** Optional sub-line (e.g. client name, file name, audience count). */
  description?: string | null;
  status: JobStatus;
  /** 0–100, or null when progress is indeterminate. */
  percent: number | null;
  /** Free-form status text (e.g. "Uploading", "Step 2 of 4"). */
  statusText?: string | null;
  /** Optional checklist for multi-step flows. */
  steps?: JobStep[];
  /** Optional error message after failure. */
  error?: string | null;
  /** Optional retry handler (re-runs the original action). */
  retry?: (() => Promise<unknown> | unknown) | null;
  /** Optional CTA shown on success (e.g. "View result"). */
  successAction?: { label: string; onClick: () => void } | null;
  startedAt: number;
  endedAt?: number | null;
};

export type JobHandle = {
  id: string;
  /** Set determinate percent (0–100). Pass null to switch to indeterminate. */
  setPercent: (p: number | null) => void;
  /** Update the status sub-text (e.g. "Uploading 4 of 10"). */
  setStatusText: (t: string | null) => void;
  /** Patch description (e.g. set file name once known). */
  setDescription: (d: string | null) => void;
  /** Initialize / replace the step checklist. */
  setSteps: (steps: JobStep[]) => void;
  /** Mark a step (by index or label) complete and advance percent if step count is known. */
  completeStep: (stepOrIndex: number | string) => void;
  /** Convenience: increment progress towards a total ("3 of 7 done"). */
  setCount: (current: number, total: number, noun?: string) => void;
};

type Listener = () => void;

class JobStore {
  private jobs: Job[] = [];
  private listeners = new Set<Listener>();

  getSnapshot = () => this.jobs;
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  private emit() {
    // Replace array ref so React sees a change.
    this.jobs = [...this.jobs];
    this.listeners.forEach((l) => l());
  }

  start(input: Omit<Partial<Job>, "id" | "status" | "startedAt"> & { title: string }): JobHandle {
    const id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const job: Job = {
      id,
      title: input.title,
      description: input.description ?? null,
      status: "pending",
      percent: input.percent ?? null,
      statusText: input.statusText ?? null,
      steps: input.steps ?? undefined,
      error: null,
      retry: input.retry ?? null,
      successAction: input.successAction ?? null,
      startedAt: Date.now(),
      endedAt: null,
    };
    this.jobs = [job, ...this.jobs];
    this.emit();

    const patch = (mut: (j: Job) => void) => {
      const idx = this.jobs.findIndex((j) => j.id === id);
      if (idx < 0) return;
      mut(this.jobs[idx]);
      this.emit();
    };

    return {
      id,
      setPercent: (p) => patch((j) => { j.percent = p == null ? null : Math.max(0, Math.min(100, Math.round(p))); }),
      setStatusText: (t) => patch((j) => { j.statusText = t; }),
      setDescription: (d) => patch((j) => { j.description = d; }),
      setSteps: (steps) => patch((j) => { j.steps = steps.map((s) => ({ ...s })); }),
      completeStep: (key) => patch((j) => {
        if (!j.steps?.length) return;
        const idx = typeof key === "number" ? key : j.steps.findIndex((s) => s.label === key);
        if (idx < 0 || idx >= j.steps.length) return;
        j.steps[idx].done = true;
        const done = j.steps.filter((s) => s.done).length;
        j.percent = Math.round((done / j.steps.length) * 100);
        j.statusText = `Step ${Math.min(done + (done < j.steps.length ? 1 : 0), j.steps.length)} of ${j.steps.length}`;
      }),
      setCount: (current, total, noun) => patch((j) => {
        if (total <= 0) return;
        j.percent = Math.round((current / total) * 100);
        j.statusText = `${current} of ${total}${noun ? ` ${noun}` : ""}`;
      }),
    };
  }

  succeed(id: string, opts?: { statusText?: string; successAction?: Job["successAction"] }) {
    const idx = this.jobs.findIndex((j) => j.id === id);
    if (idx < 0) return;
    const j = this.jobs[idx];
    j.status = "success";
    j.percent = 100;
    j.statusText = opts?.statusText ?? j.statusText ?? "Done";
    if (opts?.successAction) j.successAction = opts.successAction;
    j.endedAt = Date.now();
    j.retry = null;
    this.emit();
    // Auto-clear after a short delay so the drawer doesn't fill up forever.
    setTimeout(() => this.dismiss(id), 6000);
  }

  fail(id: string, error: unknown, retry?: () => Promise<unknown> | unknown) {
    const idx = this.jobs.findIndex((j) => j.id === id);
    if (idx < 0) return;
    const j = this.jobs[idx];
    j.status = "error";
    j.error = error instanceof Error ? error.message : String(error ?? "Action failed");
    j.endedAt = Date.now();
    if (retry) j.retry = retry;
    this.emit();
  }

  dismiss(id: string) {
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((j) => j.id !== id);
    if (this.jobs.length !== before) this.emit();
  }

  clearFinished() {
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((j) => j.status === "pending");
    if (this.jobs.length !== before) this.emit();
  }
}

export const jobStore = new JobStore();

/** Subscribe to the global job list in React. */
export function useJobs(): Job[] {
  return React.useSyncExternalStore(
    jobStore.subscribe,
    jobStore.getSnapshot,
    jobStore.getSnapshot,
  );
}

/* -------------------------------------------------------------------------- */
/* runJob — main helper                                                        */
/* -------------------------------------------------------------------------- */

export type RunJobOptions<T> = {
  title: string;
  description?: string | null;
  /** Pre-declare known steps; runner can mark them done via the handle. */
  steps?: string[];
  /** Start as indeterminate (default) or with an initial percent. */
  initialPercent?: number | null;
  /** Show a CTA on success. */
  successAction?: Job["successAction"];
  /** Optional toast on success/failure. Defaults: no success toast, error toast on. */
  successToast?: string | false;
  errorToast?: string | boolean;
  /** Friendly status sub-text while pending (e.g. "Working…"). */
  statusText?: string | null;
  onSuccess?: (value: T) => void;
  onError?: (err: unknown) => void;
};

/**
 * Run an async action with a global progress entry in the drawer.
 *
 *   await runJob(
 *     { title: "Assigning program", description: clientName, steps: [...] },
 *     async (job) => {
 *       job.setStatusText("Preparing");
 *       await prepare();
 *       job.completeStep(0);
 *       await assign();
 *       job.completeStep(1);
 *     },
 *   );
 */
export async function runJob<T>(
  opts: RunJobOptions<T>,
  fn: (job: JobHandle) => Promise<T>,
): Promise<T> {
  const handle = jobStore.start({
    title: opts.title,
    description: opts.description ?? null,
    statusText: opts.statusText ?? (opts.steps?.length ? `Step 1 of ${opts.steps.length}` : "Working…"),
    percent: opts.initialPercent ?? null,
    steps: opts.steps?.map((label) => ({ label, done: false })),
    retry: () => runJob(opts, fn),
  });
  try {
    const result = await fn(handle);
    jobStore.succeed(handle.id, { successAction: opts.successAction ?? null });
    if (opts.successToast) {
      const { toast } = await import("sonner");
      toast.success(opts.successToast);
    }
    opts.onSuccess?.(result);
    return result;
  } catch (err) {
    jobStore.fail(handle.id, err, () => runJob(opts, fn));
    if (opts.errorToast !== false) {
      const { toast } = await import("sonner");
      const msg =
        typeof opts.errorToast === "string"
          ? opts.errorToast
          : (err instanceof Error ? err.message : "Action failed");
      toast.error(msg);
    }
    opts.onError?.(err);
    throw err;
  }
}

/**
 * runBulkJob — apply an async per-item operation to a list, with live
 * "X of Y" progress and per-item error tolerance.
 */
export async function runBulkJob<TItem, TResult>(
  opts: {
    title: string;
    items: TItem[];
    itemNoun?: string;
    describeItem?: (item: TItem) => string;
    concurrency?: number;
    stopOnError?: boolean;
  },
  perItem: (item: TItem, index: number) => Promise<TResult>,
): Promise<{ results: TResult[]; errors: { index: number; error: unknown }[] }> {
  return runJob(
    { title: opts.title, description: `${opts.items.length} ${opts.itemNoun ?? "items"}`, initialPercent: 0 },
    async (job) => {
      const results: TResult[] = [];
      const errors: { index: number; error: unknown }[] = [];
      let done = 0;
      const total = opts.items.length;
      const concurrency = Math.max(1, opts.concurrency ?? 3);
      let cursor = 0;
      const next = async () => {
        while (cursor < total) {
          const i = cursor++;
          const item = opts.items[i];
          job.setStatusText(`${done} of ${total}${opts.describeItem ? ` · ${opts.describeItem(item)}` : ""}`);
          try {
            const r = await perItem(item, i);
            results[i] = r;
          } catch (e) {
            errors.push({ index: i, error: e });
            if (opts.stopOnError) throw e;
          } finally {
            done++;
            job.setCount(done, total, opts.itemNoun);
          }
        }
      };
      await Promise.all(Array.from({ length: concurrency }, () => next()));
      if (errors.length && errors.length === total) {
        throw new Error(`All ${total} ${opts.itemNoun ?? "items"} failed`);
      }
      if (errors.length) {
        job.setStatusText(`${total - errors.length} of ${total} succeeded · ${errors.length} failed`);
      }
      return { results, errors };
    },
  );
}