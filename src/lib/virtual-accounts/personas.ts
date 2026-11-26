/**
 * The starter virtual Crew accounts: original fictional people, never modelled on a client, a
 * member or anyone real. Words only: no photo, cover or media of any kind (their picture is the
 * default avatar's initials), nothing posted, no stories, comments, follows or messages. Each one
 * is a free account, disclosed as virtual wherever it shows. Bios are within the Crew's 150
 * characters; sports are the Crew's own list.
 */
export type Persona = {
  slug: string;
  first: string;
  last: string;
  bio: string;
  background: string;
  disciplines: Array<"powerlifting" | "bodybuilding" | "strength" | "glutes" | "fitness">;
};

export const STARTER_PERSONAS: Persona[] = [
  {
    slug: "maya.lifts",
    first: "Maya",
    last: "Okafor",
    bio: "Squats first, questions later. Year three of lifting.",
    background: "Fictional. Started lifting after university rec sports; trains four days a week, likes heavy squats and long rest times.",
    disciplines: ["powerlifting", "strength"],
  },
  {
    slug: "theo.trains",
    first: "Theo",
    last: "Larsen",
    bio: "Chasing a cleaner bench and better sleep.",
    background: "Fictional. Shift worker who trains early mornings; mostly upper/lower splits.",
    disciplines: ["strength", "bodybuilding"],
  },
  {
    slug: "priya.strong",
    first: "Priya",
    last: "Raman",
    bio: "Hip thrusts, hill walks and a lot of oatmeal.",
    background: "Fictional. Trains glutes and legs three days a week, walks daily, new to tracking food.",
    disciplines: ["glutes", "fitness"],
  },
  {
    slug: "diego.pulls",
    first: "Diego",
    last: "Marín",
    bio: "Deadlift day is the best day. Prove me wrong.",
    background: "Fictional. Former soccer player, two years into powerlifting, competes locally.",
    disciplines: ["powerlifting"],
  },
  {
    slug: "hannah.reps",
    first: "Hannah",
    last: "Reid",
    bio: "Getting stronger at 41. One workout at a time.",
    background: "Fictional. Returned to the gym after a long break; full-body three days a week.",
    disciplines: ["fitness", "strength"],
  },
  {
    slug: "kofi.benches",
    first: "Kofi",
    last: "Mensah",
    bio: "Bench, rows, repeat. Slowly building a bigger back.",
    background: "Fictional. Bodybuilding-style split, five days a week, loves high-rep back work.",
    disciplines: ["bodybuilding"],
  },
  {
    slug: "ellie.moves",
    first: "Ellie",
    last: "Novak",
    bio: "First year lifting. Learning the big three.",
    background: "Fictional. Beginner following a library plan, logs every set, asks lots of questions.",
    disciplines: ["fitness"],
  },
  {
    slug: "sam.at.home",
    first: "Sam",
    last: "Whitford",
    bio: "Garage gym, two kids, no excuses. Most days.",
    background: "Fictional. Trains at home with a rack, barbell and adjustable dumbbells.",
    disciplines: ["strength", "fitness"],
  },
  {
    slug: "aiyana.squats",
    first: "Aiyana",
    last: "Brooks",
    bio: "Paused squats build character.",
    background: "Fictional. Intermediate powerlifter prepping for a first meet next year.",
    disciplines: ["powerlifting", "glutes"],
  },
  {
    slug: "graham.masters",
    first: "Graham",
    last: "Ellis",
    bio: "Masters lifter. Warm-ups take longer every year.",
    background: "Fictional. Lifting since his thirties, now 58, trains three days and walks every day.",
    disciplines: ["strength", "powerlifting"],
  },
  {
    slug: "lena.builds",
    first: "Lena",
    last: "Hoffmann",
    bio: "Shoulders and patience. Mostly patience.",
    background: "Fictional. Physique-focused, six-day push/pull/legs, careful with nutrition.",
    disciplines: ["bodybuilding"],
  },
  {
    slug: "jordan.newbie",
    first: "Jordan",
    last: "Pike",
    bio: "Week six. Still sore. Still showing up.",
    background: "Fictional. Brand new to training, follows a beginner plan, walks after work.",
    disciplines: ["fitness"],
  },
];
