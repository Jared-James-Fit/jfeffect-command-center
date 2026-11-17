/**
 * The Meet Day — Final Preparation Checklist template, as data (pure).
 *
 * The migration that seeds it (20270401091000_meet_day_checklist.sql) is
 * written from this file by scripts/forms/write-meet-checklist-migration.ts,
 * and meet-checklist.test.ts fails when the two disagree. Once it's in the
 * database the coach edits it in the form builder like any other form: these
 * ids are only where it starts.
 *
 * Every item from the original Google Form is here (documents, clothing and
 * equipment, accessories, food and supplies, opening attempts); the rest is
 * what a meet actually goes wrong on (registration, weigh-in time, the
 * handler, openers agreed with the coach), each one a tap.
 */
import { MEET_CHECKLIST_FORM_ID, MEET_CHECKLIST_FORM_TYPE } from "@/lib/meet-checklist";

export type TemplateQuestion = {
  id: string;
  question_type: string;
  label: string;
  help_text: string | null;
  required: boolean;
  options: string[];
  validation: Record<string, unknown>;
  conditional_logic: Record<string, unknown>;
};

export type TemplateForm = {
  id: string;
  title: string;
  description: string;
  form_type: string;
  button_label: string;
  category: string;
  allow_updates: boolean;
  settings: Record<string, unknown>;
  questions: TemplateQuestion[];
};

const qid = (n: number) => `c0a1e7e0-5a7e-4c0d-9f00-000000000${String(n).padStart(3, "0")}`;

export const MEET_QUESTION_IDS = {
  aboutInfo: qid(201),
  name: qid(202),
  meetName: qid(203),
  meetDate: qid(204),
  weightClass: qid(205),
  bodyweight: qid(206),
  weightConcern: qid(207),
  weightDetails: qid(208),
  handlerInfo: qid(209),
  handler: qid(210),
  handlerName: qid(211),
  handlerPhone: qid(212),
  handlerEmail: qid(213),
  logistics: qid(214),
  documents: qid(215),
  shoes: qid(216),
  equipment: qid(217),
  supplies: qid(218),
  final: qid(219),
  notes: qid(220),
} as const;

export const HANDLER = {
  confirmed: "Yes, my handler is confirmed",
  needHelp: "I need help finding a handler",
  coach: "My coach is handling me",
  self: "I'm handling myself",
  notYet: "Not confirmed yet",
} as const;

export const CONCERN = {
  none: "No concerns",
  slight: "Slightly concerned",
  discuss: "Need to discuss with coach",
} as const;

export const SHOES = {
  one: "One pair for all three lifts",
  split: "Different shoes for some lifts",
} as const;

/** The competition form's weight classes (IPF / CPU), so both forms read alike. */
export const WEIGHT_CLASSES = [
  "Men's 53 kg (sub-junior & junior only)",
  "Men's 59 kg",
  "Men's 66 kg",
  "Men's 74 kg",
  "Men's 83 kg",
  "Men's 93 kg",
  "Men's 105 kg",
  "Men's 120 kg",
  "Men's 120 kg+",
  "Women's 43 kg (sub-junior & junior only)",
  "Women's 47 kg",
  "Women's 52 kg",
  "Women's 57 kg",
  "Women's 63 kg",
  "Women's 69 kg",
  "Women's 76 kg",
  "Women's 84 kg",
  "Women's 84 kg+",
];

const Q = MEET_QUESTION_IDS;
const handlerConfirmed = [{ question_id: Q.handler, op: "equals", value: HANDLER.confirmed }];

function q(id: string, type: string, label: string, opts: Partial<Omit<TemplateQuestion, "id" | "question_type" | "label">> = {}): TemplateQuestion {
  return {
    id,
    question_type: type,
    label,
    help_text: opts.help_text ?? null,
    required: opts.required ?? false,
    options: opts.options ?? [],
    validation: opts.validation ?? {},
    conditional_logic: opts.conditional_logic ?? {},
  };
}

type Item = { key: string; label: string; priority: "critical" | "important" | "optional"; help?: string; show_if?: unknown[] };
const items = (list: Item[]) => list.map((i) => ({ key: i.key, label: i.label, priority: i.priority, ...(i.help ? { help: i.help } : {}), ...(i.show_if ? { show_if: i.show_if } : {}) }));

export const MEET_CHECKLIST_TEMPLATE: TemplateForm = {
  id: MEET_CHECKLIST_FORM_ID,
  title: "Meet Day — Final Preparation Checklist",
  description: "Make sure everything is ready before competition day.",
  form_type: MEET_CHECKLIST_FORM_TYPE,
  button_label: "Save my checklist",
  category: "Powerlifting & Competitions",
  allow_updates: true,
  settings: {
    readiness: {
      areas: [
        { key: "documents", label: "Documents", ok: "Complete", attention: "Needs attention" },
        { key: "equipment", label: "Equipment", ok: "Complete", attention: "Needs attention" },
        { key: "handler", label: "Handler", ok: "Confirmed", attention: "Unresolved" },
        { key: "weight", label: "Weight", ok: "No concern reported", attention: "Coach review needed" },
        { key: "logistics", label: "Meet logistics", ok: "Complete", attention: "Needs attention" },
        { key: "final", label: "Final preparation", ok: "Complete", attention: "Incomplete" },
      ],
    },
    reminders: true,
  },
  questions: [
    q(Q.aboutInfo, "info", "Your meet and weight", { help_text: "What we already know is filled in. Fix anything that's changed." }),
    q(Q.name, "short_text", "Your name", { required: true, validation: { prefill: "full_name", meet_key: "name", compact: true } }),
    q(Q.meetName, "short_text", "Which meet is this for?", { required: true, validation: { prefill: "meet_name", meet_key: "meet_name" } }),
    q(Q.meetDate, "date", "Meet date", { required: true, validation: { prefill: "meet_date", meet_key: "meet_date" } }),
    q(Q.weightClass, "single_choice", "Weight class", {
      required: true,
      options: WEIGHT_CLASSES,
      validation: { prefill: "meet_weight_class", group_prefixes: ["Men's ", "Women's "], meet_key: "weight_class", area: "weight" },
    }),
    q(Q.bodyweight, "number", "Morning bodyweight", {
      required: true,
      help_text: "First thing, after the bathroom, before you eat or drink.",
      validation: { units: ["lb", "kg"], prefill: "bodyweight", meet_key: "bodyweight", area: "weight" },
    }),
    q(Q.weightConcern, "single_choice", "Any concerns about making weight?", {
      required: true,
      options: [CONCERN.none, CONCERN.slight, CONCERN.discuss],
      validation: { flag_options: [CONCERN.slight, CONCERN.discuss], meet_key: "weight_concern", area: "weight" },
    }),
    q(Q.weightDetails, "long_text", "What's going on with your weight?", {
      help_text: "Where you're at and what's changed. Your coach will go through it with you.",
      validation: { meet_key: "weight_details" },
      conditional_logic: {
        match: "all",
        show_if: [
          { question_id: Q.weightConcern, op: "is_not_empty", value: "" },
          { question_id: Q.weightConcern, op: "not_equals", value: CONCERN.none },
        ],
      },
    }),
    q(Q.handlerInfo, "info", "Handler and logistics"),
    q(Q.handler, "single_choice", "Your handler", {
      required: true,
      help_text: "Who's with you on the day to keep you on time and hand in your attempts.",
      options: [HANDLER.confirmed, HANDLER.coach, HANDLER.self, HANDLER.needHelp, HANDLER.notYet],
      validation: { flag_options: [HANDLER.needHelp, HANDLER.notYet], meet_key: "handler", area: "handler" },
    }),
    q(Q.handlerName, "short_text", "Handler's name", {
      required: true,
      validation: { remember: true, meet_key: "handler_name" },
      conditional_logic: { match: "all", show_if: handlerConfirmed },
    }),
    q(Q.handlerPhone, "short_text", "Handler's phone", {
      validation: { remember: true, input: "tel", meet_key: "handler_phone" },
      conditional_logic: { match: "all", show_if: handlerConfirmed },
    }),
    q(Q.handlerEmail, "short_text", "Handler's email", {
      validation: { remember: true, input: "email", meet_key: "handler_email" },
      conditional_logic: { match: "all", show_if: handlerConfirmed },
    }),
    q(Q.logistics, "checklist", "Meet logistics", {
      required: true,
      validation: {
        area: "logistics",
        items: items([
          { key: "registered", label: "Registered for the meet", priority: "critical" },
          { key: "weigh-in", label: "Weigh-in day and time known", priority: "critical", help: "On your meet's schedule. At IPF / CPU meets it's usually 2 hours before your session." },
          { key: "venue", label: "Venue and how you're getting there", priority: "important" },
          { key: "travel", label: "Travel and where you're staying", priority: "important", help: "N/A if it's close to home." },
          { key: "rules", label: "Rules and commands reviewed", priority: "important", help: "Squat: “Squat”, “Rack”. Bench: “Start”, “Press”, “Rack”. Deadlift: “Down”. Check your meet's rulebook." },
          { key: "kit", label: "Gear on the approved list, and you know if there's a kit check", priority: "important", help: "Singlet, belt, sleeves and wraps need to be on your federation's approved list." },
        ]),
      },
    }),
    q(Q.documents, "checklist", "Documents and eligibility", {
      required: true,
      validation: {
        area: "documents",
        items: items([
          { key: "membership", label: "CPU membership, printed or PDF", priority: "critical" },
          { key: "cces", label: "CCES True Sport Clean course, printed or proof you finished it", priority: "critical", help: "Where your meet requires it. N/A if it doesn't." },
          { key: "photo-id", label: "Valid photo ID", priority: "critical" },
        ]),
      },
    }),
    q(Q.shoes, "single_choice", "Your lifting shoes", {
      required: true,
      options: [SHOES.one, SHOES.split],
      validation: { remember: true, meet_key: "shoes" },
    }),
    q(Q.equipment, "checklist", "Clothing and equipment", {
      required: true,
      validation: {
        area: "equipment",
        ready_label: "Packed",
        items: items([
          { key: "singlet", label: "Singlet", priority: "critical" },
          { key: "shirt", label: "Competition shirt", priority: "critical", help: "For squat and bench at IPF / CPU meets." },
          { key: "underwear", label: "Underwear", priority: "important" },
          { key: "belt", label: "Belt", priority: "critical" },
          { key: "knee-sleeves", label: "Knee sleeves", priority: "optional" },
          { key: "wrist-wraps", label: "Wrist wraps", priority: "optional" },
          { key: "shoes", label: "Lifting shoes", priority: "critical", show_if: [{ question_id: Q.shoes, op: "equals", value: SHOES.one }] },
          { key: "squat-shoes", label: "Squat shoes", priority: "critical", show_if: [{ question_id: Q.shoes, op: "equals", value: SHOES.split }] },
          { key: "bench-shoes", label: "Bench shoes", priority: "optional", show_if: [{ question_id: Q.shoes, op: "equals", value: SHOES.split }] },
          { key: "deadlift-shoes", label: "Deadlift shoes", priority: "optional", show_if: [{ question_id: Q.shoes, op: "equals", value: SHOES.split }] },
          { key: "squat-socks", label: "Squat socks", priority: "optional" },
          { key: "bench-socks", label: "Bench socks", priority: "optional" },
          { key: "deadlift-socks", label: "Deadlift socks", priority: "important", help: "Long enough to cover your shins at IPF / CPU meets." },
        ]),
      },
    }),
    q(Q.supplies, "checklist", "Food, drinks and accessories", {
      required: true,
      validation: {
        area: "equipment",
        ready_label: "Packed",
        items: items([
          { key: "food", label: "Food and drinks for the day", priority: "important" },
          { key: "meds", label: "Any medication or personal supplies you need", priority: "important", help: "N/A if there's nothing." },
          { key: "chalk", label: "Chalk", priority: "important", help: "Not every meet supplies it." },
          { key: "powder", label: "Baby powder", priority: "optional", help: "For deadlift, where your meet allows it." },
          { key: "food-scale", label: "Food scale", priority: "optional", help: "If you're weighing food." },
          { key: "bw-scale", label: "Bodyweight scale", priority: "optional", help: "To check your weight before weigh-in." },
          { key: "hair-ties", label: "Hair ties", priority: "optional", help: "If you have long hair." },
          { key: "headphones", label: "Headphones or earbuds", priority: "optional" },
        ]),
      },
    }),
    q(Q.final, "checklist", "Final meet-day confirmation", {
      required: true,
      validation: {
        area: "final",
        items: items([
          { key: "openers-written", label: "Opening attempts written down", priority: "important" },
          { key: "openers-coach", label: "Openers confirmed with your coach", priority: "important" },
          { key: "warm-ups", label: "Warm-up plan reviewed", priority: "important" },
          { key: "schedule", label: "Flight and session times known", priority: "important" },
          { key: "handler-plan", label: "Handler knows your attempts, warm-ups and timing", priority: "important", show_if: handlerConfirmed },
          { key: "sleep", label: "Sleep and the night before planned", priority: "optional" },
        ]),
      },
    }),
    q(Q.notes, "long_text", "Anything else I should know?", {
      help_text: "Travel, nerves, a niggle, anything that could affect the day.",
    }),
  ],
};
