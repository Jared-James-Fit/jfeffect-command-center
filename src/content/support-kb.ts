/**
 * JF Effect Support's knowledge base: the only things Cleo may tell someone in
 * the JF Effect Support chat (support-cleo, Nov 25 2026). Written from the app's
 * real screens and routes; every link is an in-app path that exists
 * (support-kb.test.ts checks each against src/routes). When a screen moves or a
 * feature changes, change its article here and bump SUPPORT_KB_VERSION; when
 * something isn't here, Cleo says so and hands the chat to the team.
 *
 * Never put a price, a promise, a policy exception or anything about a
 * particular person in an article: billing, refunds, plan changes and account
 * access are always the team's (Cleo hands those off, rules.ts).
 */

export const SUPPORT_KB_VERSION = "2026-11-25.1";

export type KbTier = "self_serve" | "coaching";
export type KbLink = { label: string; to: string };
export type KbArticle = {
  id: string;
  title: string;
  /** Words a question about it is likely to use (lower case). */
  keywords: string[];
  /** Who has the feature; absent = everyone. */
  tiers?: KbTier[];
  /** What Cleo may say, in plain words. */
  answer: string;
  links: KbLink[];
};

export const SUPPORT_KB: KbArticle[] = [
  {
    id: "support-chat",
    title: "Getting help: JF Effect Support",
    keywords: ["help", "support", "contact", "question", "talk", "person", "human", "reply", "team", "jared"],
    answer:
      "JF Effect Support is the chat pinned in Messages. Cleo, JF Effect's assistant, answers app and account questions first; anything Cleo can't answer goes to the JF Effect team, who reply in the same chat, usually within a day. Tap \"Talk to a person\" at any time to reach the team. You get a notification when they reply.",
    links: [{ label: "Messages", to: "/portal/messages" }],
  },
  {
    id: "coach-chat",
    title: "Messaging your coach",
    tiers: ["coaching"],
    keywords: ["coach", "message coach", "chat", "check-in", "check in", "form", "reply", "jared"],
    answer:
      "Your coach's chat is the first chat in Messages. Training, nutrition and anything about your plan goes there; check-ins and forms your coach sends show up in that chat too. JF Effect Support is for questions about the app itself.",
    links: [{ label: "Messages", to: "/portal/messages" }],
  },
  {
    id: "log-workout",
    title: "Logging a workout",
    keywords: ["log", "logging", "workout", "set", "sets", "reps", "weight", "rpe", "logger", "record", "save", "today"],
    answer:
      "Open Workouts and tap today's workout. Reps and RPE are already filled in from your program: type set 1's weight and the sets below it fill in and log with it. Swipe a set left to skip or delete it. Everything saves as you go, so you can leave and come back. \"Log faster\" (the ? beside List / Focus) shows the quickest moves again.",
    links: [{ label: "Workouts", to: "/portal/workouts" }],
  },
  {
    id: "workout-history",
    title: "Past workouts, PRs and analytics",
    keywords: ["history", "past", "previous", "pr", "prs", "personal record", "best", "analytics", "progress", "strength", "chart", "volume"],
    answer:
      "Workouts shows where you are in your program. Your personal records are under Workouts → PRs, and Training analytics shows your strength, training and records over time.",
    links: [
      { label: "PRs", to: "/portal/workouts/prs" },
      { label: "Training analytics", to: "/portal/workouts/analytics" },
    ],
  },
  {
    id: "start-program",
    title: "Starting or switching a program",
    tiers: ["self_serve"],
    keywords: ["program", "plan", "start", "switch", "change program", "new program", "library", "routine", "end program"],
    answer:
      "Programs has the JF Effect plans, the crew's programs and your own. Open a plan to see what it is, then start it: its workouts go on your calendar on your training days. You can end or switch a program from the same page; your logged history stays.",
    links: [{ label: "Programs", to: "/portal/programs" }],
  },
  {
    id: "coaching-program",
    title: "Your coaching program",
    tiers: ["coaching"],
    keywords: ["program", "plan", "change program", "new program", "block", "exercises", "swap"],
    answer:
      "Your coach writes and updates your program; it shows in Workouts and on your calendar. To change something about the program itself, message your coach in Messages.",
    links: [
      { label: "Workouts", to: "/portal/workouts" },
      { label: "Messages", to: "/portal/messages" },
    ],
  },
  {
    id: "build-import",
    title: "Building or importing your own program",
    keywords: ["build", "builder", "create program", "my own program", "import", "pdf", "spreadsheet", "copy"],
    answer:
      "In Programs you can build your own program from scratch, or import one you already have (a PDF, photos or a file). An import is read into the app for you to check before anything is saved.",
    links: [
      { label: "Build a program", to: "/portal/programs/new" },
      { label: "Import a program", to: "/portal/programs/import" },
    ],
  },
  {
    id: "calendar",
    title: "Calendar and moving workouts",
    keywords: ["calendar", "schedule", "move", "reschedule", "day", "days", "missed", "skip", "tomorrow"],
    answer:
      "Calendar shows your workouts and anything else booked. You can always move your own upcoming workouts there. Your usual training days are under Account → Units & training days.",
    links: [
      { label: "Calendar", to: "/portal/calendar" },
      { label: "Units & training days", to: "/portal/account#units" },
    ],
  },
  {
    id: "units",
    title: "Pounds or kilograms",
    keywords: ["units", "unit", "kg", "kilograms", "lb", "lbs", "pounds", "metric", "imperial"],
    answer: "Change pounds or kilograms under Account → Units & training days.",
    links: [{ label: "Units & training days", to: "/portal/account#units" }],
  },
  {
    id: "progress",
    title: "Progress photos, bodyweight and measurements",
    keywords: ["progress", "photo", "photos", "picture", "bodyweight", "body weight", "weigh", "weight in", "measurements", "compare"],
    answer: "Progress is where your photos, videos, bodyweight and measurements live, with side-by-side compare.",
    links: [{ label: "Progress", to: "/portal/progress" }],
  },
  {
    id: "nutrition",
    title: "Nutrition and logging food",
    keywords: ["nutrition", "food", "macros", "calories", "protein", "log food", "meal", "eat", "targets", "diet"],
    answer:
      "Nutrition has your targets and your food log. Log a meal from Saved, Quick add (the numbers off a label) or Describe (type what you ate for an estimate). Members' targets are suggested estimates, not medical advice.",
    links: [{ label: "Nutrition", to: "/portal/nutrition-targets" }],
  },
  {
    id: "crew",
    title: "The Crew: feed, posts and rankings",
    keywords: ["crew", "community", "feed", "post", "share", "story", "rankings", "league", "leaderboard", "follow", "like"],
    answer:
      "Crew is the community: the feed, your posts and stories, and Rankings. Share a workout or a photo with the + at the top of Crew.",
    links: [{ label: "Crew", to: "/portal/community" }],
  },
  {
    id: "challenges",
    title: "Challenges",
    keywords: ["challenge", "challenges", "compete", "competition", "event", "join challenge"],
    answer: "Open Challenges to see what's running and join one.",
    links: [{ label: "Challenges", to: "/challenges" }],
  },
  {
    id: "dms",
    title: "Messaging other members",
    keywords: ["dm", "direct message", "message someone", "group chat", "request", "block", "chat with"],
    answer:
      "In Messages, tap the pencil to message someone or start a group. A first message to someone who doesn't follow you arrives as a request they can accept. Hold a chat to pin, mute or delete it; Blocked is under Edit.",
    links: [{ label: "Messages", to: "/portal/messages" }],
  },
  {
    id: "notifications",
    title: "Notifications, sounds and haptics",
    keywords: ["notification", "notifications", "push", "alerts", "sound", "sounds", "haptics", "vibrate", "quiet"],
    answer:
      "Turn notifications, sounds and haptics on or off under Account → Notifications, sounds & haptics. On an iPhone the app must be installed to the home screen (or the JF Effect app) to get notifications.",
    links: [{ label: "Notifications", to: "/portal/account#notifications" }],
  },
  {
    id: "install",
    title: "Installing the app",
    keywords: ["install", "home screen", "download", "app store", "iphone", "android", "pwa"],
    answer: "The install steps for your phone are on the Install page, and under Account → Install the app.",
    links: [{ label: "Install the app", to: "/install" }],
  },
  {
    id: "password",
    title: "Password and signing in",
    keywords: ["password", "change password", "forgot", "reset", "sign in", "log in", "login"],
    answer:
      "Change your password under Account → Password. If you're signed out and forgot it, use \"Forgot password?\" on the sign-in screen. Anything else about getting into an account goes to the team.",
    links: [{ label: "Password", to: "/portal/account#password" }],
  },
  {
    id: "profile",
    title: "Your profile and personal details",
    keywords: ["profile", "name", "photo", "avatar", "details", "phone", "address", "social", "instagram"],
    answer: "Your photo, name, contact details and social links are in Account.",
    links: [{ label: "Account", to: "/portal/account" }],
  },
  {
    id: "your-plan",
    title: "Your plan: Free, membership or coaching",
    keywords: ["plan", "upgrade", "coaching", "membership", "free", "subscription", "downgrade", "switch plan", "apply"],
    answer:
      "Account → Your plan shows the plan you're on and the ways to change it, on the same account, keeping everything you've logged. For anything about a charge, a refund or an exception, the team handles it.",
    links: [{ label: "Your plan", to: "/portal/plan" }],
  },
  {
    id: "goals-setup",
    title: "Goals & Setup",
    tiers: ["coaching"],
    keywords: ["goals", "setup", "onboarding", "intake", "questionnaire", "agreement"],
    answer: "Your coach's onboarding is Goals & Setup; the steps still open show on Home.",
    links: [
      { label: "Goals & Setup", to: "/portal/goals-setup" },
      { label: "Home", to: "/portal" },
    ],
  },
  {
    id: "tools",
    title: "Calculators",
    tiers: ["self_serve"],
    keywords: ["calculator", "1rm", "one rep max", "plate", "water", "sleep", "macro calculator", "tools"],
    answer: "Tools has a one-rep-max, macro, plate, water and sleep calculator.",
    links: [{ label: "Tools", to: "/portal/tools" }],
  },
  {
    id: "exercises",
    title: "Exercise library",
    keywords: ["exercise", "exercises", "how to", "demo", "video", "technique", "form", "library"],
    answer: "Exercises is the library of every exercise in the app: search it by name, or describe one if you don't know its name.",
    links: [{ label: "Exercises", to: "/portal/exercises" }],
  },
  {
    id: "delete-account",
    title: "Deactivating or deleting your account",
    keywords: ["delete", "delete account", "deactivate", "close account", "remove account", "privacy", "data"],
    answer:
      "Deactivate account and Privacy & data → Delete my account are in Account. A deletion request isn't carried out on the spot and can be withdrawn in the meantime.",
    links: [{ label: "Privacy & data", to: "/portal/account#legal" }],
  },
  {
    id: "help-tutorials",
    title: "Help & Tutorials",
    keywords: ["tutorial", "tutorials", "how does", "guide", "tour", "walkthrough", "learn", "onboarding", "getting started"],
    answer:
      "Account → Help & Tutorials replays any tutorial for the parts of the app you have, lets you finish setup, and searches these help answers.",
    links: [{ label: "Help & Tutorials", to: "/portal/account#help" }],
  },
];

/** Every in-app link in the knowledge base: the only links Cleo may send. */
export function kbLinks(articles: KbArticle[] = SUPPORT_KB): string[] {
  return [...new Set(articles.flatMap((a) => a.links.map((l) => l.to)))];
}
