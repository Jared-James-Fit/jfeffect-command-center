/**
 * The meet day in order (pure, tested): wake-up to the last deadlift, built
 * from the weigh-in timing and the lifting start when they're known. Fuelling
 * follows the weight-management rules (never dehydration, water loading,
 * sodium tricks or a crash cut): eat and drink normally after the weigh-in,
 * familiar food, fluids through the day, and caffeine only in an amount they
 * already use in training. Times are clock times when the start is known,
 * else relative to the weigh-in.
 */
import type { FederationRules } from "./rules";

export type DayStep = { at: string | null; relative: string; title: string; detail: string[] };

const pad = (n: number) => String(n).padStart(2, "0");
function shift(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  let t = h * 60 + m + minutes;
  t = ((t % 1440) + 1440) % 1440;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}

export function planGameDay(input: {
  rules: FederationRules;
  /** "09:00" when the first flight's start is known */
  liftingStart?: string | null;
  /** "07:00" when the weigh-in time is known */
  weighInAt?: string | null;
  flight?: string | null;
  /** they're cutting to make the class (from the bodyweight read): only changes the morning's wording */
  makingWeight?: boolean;
  /** caffeine they use in training (mg), when known */
  caffeineMg?: number | null;
  cues?: Partial<Record<"squat" | "bench" | "deadlift", string[]>>;
}): DayStep[] {
  const wiHours = input.rules.weighInHours ?? 2;
  const start =
    input.liftingStart && /^\d{2}:\d{2}$/.test(input.liftingStart) ? input.liftingStart : null;
  const weighIn =
    input.weighInAt && /^\d{2}:\d{2}$/.test(input.weighInAt)
      ? input.weighInAt
      : start && wiHours <= 3
        ? shift(start, -wiHours * 60)
        : null;
  const sameDay = wiHours <= 3;
  const at = (base: string | null, minutes: number) => (base ? shift(base, minutes) : null);
  const steps: DayStep[] = [];
  if (sameDay) {
    steps.push({
      at: at(weighIn, -150),
      relative: "2½ hours before weigh-in",
      title: "Wake up",
      detail: input.makingWeight
        ? [
            "Check bodyweight on the same scale as the last few mornings",
            "A small familiar breakfast only if there's room under the limit; otherwise eat straight after weigh-in",
          ]
        : ["A normal, familiar breakfast", "Water as usual"],
    });
  } else {
    steps.push({
      at: null,
      relative: "The day before",
      title: "Weigh-in (24-hour)",
      detail: [
        "Weigh in, then eat and drink normally the rest of the day: familiar food, nothing new",
        "Sleep is the priority tonight",
      ],
    });
    steps.push({
      at: at(start, -180),
      relative: "3 hours before lifting",
      title: "Wake up",
      detail: ["A normal, familiar breakfast", "Fluids as usual"],
    });
  }
  steps.push({
    at: at(weighIn ?? start, sameDay ? -40 : -75),
    relative: sameDay ? "40 minutes before weigh-in" : "75 minutes before lifting",
    title: "Arrive",
    detail: [
      "Kit check against the meet checklist",
      "Find the warm-up room, the platform and where attempts are handed in",
    ],
  });
  if (sameDay) {
    steps.push({
      at: weighIn,
      relative: "Weigh-in",
      title: "Weigh in and hand in openers",
      detail: [
        "Openers and rack heights confirmed before you go in",
        "Straight after: eat and drink what was planned (carbohydrate and fluids, food you know sits well)",
      ],
    });
  }
  steps.push({
    at: at(start, -60),
    relative: "1 hour before the flight",
    title: "General warm-up",
    detail: [
      "Easy movement, then the squat warm-up routine",
      `Caffeine${input.caffeineMg ? ` (about ${input.caffeineMg} mg, what they use in training)` : " only if they use it in training, the same amount"} about 45 minutes before the opener`,
    ],
  });
  steps.push({
    at: start,
    relative: "Flight starts",
    title: "Squat",
    detail: [
      "Warm-ups on the plan's timing: last warm-up when about 8 attempts are left",
      ...(input.cues?.squat ?? []),
    ],
  });
  steps.push({
    at: null,
    relative: "After squats",
    title: "Between squat and bench",
    detail: [
      "A small snack and fluids within 10 minutes",
      "Stay warm; don't sit for the whole break",
    ],
  });
  steps.push({
    at: null,
    relative: "Bench",
    title: "Bench",
    detail: ["Warm the shoulders up again before the barbell sets", ...(input.cues?.bench ?? [])],
  });
  steps.push({
    at: null,
    relative: "After bench",
    title: "Between bench and deadlift",
    detail: [
      "Snack and fluids again",
      "Check the live totals: the deadlift strategy may change with the standings",
    ],
  });
  steps.push({
    at: null,
    relative: "Deadlift",
    title: "Deadlift",
    detail: [
      "Thirds are decided against the live standings and the objective",
      ...(input.cues?.deadlift ?? []),
    ],
  });
  return steps;
}
