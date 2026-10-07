import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SEX_OPTIONS, SEX_REASON, type AthleteSex } from "@/lib/athlete-sex";
import { getMySexFn, saveMySexFn } from "@/lib/athlete-sex.functions";

/** Every query that reads the athlete's sex, refreshed after an answer. */
export const ATHLETE_SEX_KEYS = [["athlete-sex"], ["form-prefill-profile"], ["sbd-split"]] as const;

/** Three-way segmented choice: Male · Female · Prefer not to say. */
export function SexChoice({
  value,
  onChange,
  disabled,
  pending,
  className,
}: {
  value: AthleteSex | null | undefined;
  onChange: (v: AthleteSex) => void;
  disabled?: boolean;
  /** The option being saved, shown with a spinner. */
  pending?: AthleteSex | null;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-3 gap-1.5", className)} role="radiogroup" aria-label="Sex">
      {SEX_OPTIONS.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border px-2 text-sm font-bold leading-tight transition-colors disabled:opacity-60",
              on
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background hover:bg-secondary",
            )}
          >
            {pending === o.value && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span className="text-center">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * One-tap question for athletes who haven't answered yet. Non-blocking,
 * shown only to the athlete themself (never in "view as client"), and gone
 * for good once answered — the saved answer is the "seen" state.
 */
export function SexPromptCard({
  enabled = true,
  className,
}: {
  enabled?: boolean;
  className?: string;
}) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<AthleteSex | null>(null);
  const { data } = useQuery({
    queryKey: ["athlete-sex", "me"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: () => getMySexFn(),
  });
  const save = useMutation({
    mutationFn: (sex: AthleteSex) => saveMySexFn({ data: { sex } }),
    onMutate: (sex) => setPending(sex),
    onSuccess: async () => {
      toast.success("Saved to your profile");
      await Promise.all(
        ATHLETE_SEX_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey: [...queryKey] })),
      );
    },
    onError: (e: unknown) => toast.error("Couldn't save", { description: (e as Error)?.message }),
    onSettled: () => setPending(null),
  });

  if (!enabled || !data || data.account === "none" || data.sex) return null;

  return (
    <Card className={cn("border-primary/25 bg-primary/5 p-4", className)} data-testid="sex-prompt">
      <div className="mb-3 flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
          <UserRound className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-black">Quick one: what's your sex?</div>
          <p className="text-xs text-muted-foreground">{SEX_REASON}</p>
        </div>
      </div>
      <SexChoice
        value={null}
        onChange={(v) => save.mutate(v)}
        disabled={save.isPending}
        pending={pending}
      />
    </Card>
  );
}
