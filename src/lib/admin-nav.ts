import {
  LayoutDashboard, CreditCard, Package, Dumbbell, Calendar,
  Settings, Apple, MessageCircle, BookOpen,
  Activity, Wrench, HelpCircle, Trophy, UsersRound, Target, Camera,
} from "lucide-react";
import type { NavItem } from "@/components/app-shell";

/**
 * Pages that belong to Workouts though they live at their own address: a
 * program, the library and a plan's page are reached from Workouts and lead
 * back to it, so its tab stays lit there (a page that lights no tab reads as
 * somewhere else in the app).
 */
export const WORKOUTS_AREA = ["/portal/programs", "/portal/plans", "/portal/exercises"];

// Staff menus live in `@/lib/internal-nav` (one role-aware registry for the
// sidebar, More and the phone bar). These are the client portal's.

export const clientNav: NavItem[] = [
  { to: "/portal", label: "Home", icon: LayoutDashboard },
  { to: "/portal/goals-setup", label: "Goals & Setup", icon: Target },
  { to: "/portal/messages", label: "Messages", icon: MessageCircle },
  { to: "/portal/workouts", label: "Workouts", icon: Activity },
  // One Calendar: workouts, sessions, calls, events and key dates (old
  // Appointments / Events / Schedule pages redirect here). Right after
  // Workouts, so it's easy to find in the menu.
  { to: "/portal/calendar", label: "Calendar", icon: Calendar, keywords: ["calendar","schedule","appointments","sessions","events","booking","reschedule","cancel"] },
  { to: "/portal/programs", label: "Programs", icon: BookOpen, keywords: ["programs","build","builder","share","copy","crew programs","templates","routines"] },
  { to: "/portal/progress", label: "Progress", icon: Camera, keywords: ["progress","photos","videos","bodyweight","measurements","check-in","compare"] },
  { to: "/portal/nutrition-targets", label: "Nutrition", icon: Apple, keywords: ["nutrition","macros","targets","recipes","meals"] },
  { to: "/portal/community", label: "Crew", icon: UsersRound, keywords: ["crew","feed","rankings","league","rank","leaderboard","hall of strength","strength","community","members","shared workouts","posts","photos","reactions","activity"] },
  { to: "/challenges", label: "Challenges", icon: Trophy, keywords: ["challenge","competition","event","bench 225","leaderboard","compete","prize","winnipeg 225"] },
  { to: "/portal/exercises", label: "Exercises", icon: Dumbbell },
  { to: "/portal/purchases", label: "My Purchases", icon: Package },
  // The Coaching Agreement is a section of Account (the old Agreements page lands there).
  { to: "/portal/account", label: "Account Settings", icon: Settings, keywords: ["account","settings","agreement","coaching agreement","contract","signed","password","units","notifications","privacy"] },
];

// Mobile bottom-tab nav for the client portal: five equal tabs (TikTok's /
// Instagram's), Crew in the middle with a count when there are new posts
// (Rankings is the trophy bubble at the start of Crew's stories). "More" opens
// from the top bar instead (AppShell `moreInHeader`). Messages sits right after
// Crew (the coach is one thumb-reach away) and Nutrition takes the far right.
export const clientBottomNav: NavItem[] = [
  { to: "/portal", label: "Home", icon: LayoutDashboard },
  // Programs and a plan's page are part of Workouts: the tab stays lit there
  { to: "/portal/workouts", label: "Workouts", icon: Activity, activeOn: WORKOUTS_AREA },
  { to: "/portal/community", label: "Crew", icon: UsersRound },
  { to: "/portal/messages", label: "Messages", icon: MessageCircle },
  { to: "/portal/nutrition-targets", label: "Nutrition", icon: Apple },
];

// JF Membership (self-serve) in the portal: the same app as coaching clients,
// minus the coach (Messages, Check-Ins, Agreements, Goals & Setup, Purchases),
// plus what a member manages themselves: plans, support, their membership.
export const selfServeNav: NavItem[] = [
  { to: "/portal", label: "Home", icon: LayoutDashboard },
  { to: "/portal/workouts", label: "Workouts", icon: Activity },
  { to: "/portal/calendar", label: "Calendar", icon: Calendar, keywords: ["calendar","schedule","workouts","events"] },
  // one row: JF Effect plans, the crew's and your own are Programs' tabs
  { to: "/portal/programs", label: "Programs", icon: BookOpen, keywords: ["plans","programs","library","jf effect plans","coach-written","saved","my programs","start","training","build","builder","share","copy","routines","end program","switch program"] },
  { to: "/portal/progress", label: "Progress", icon: Camera, keywords: ["progress","photos","videos","bodyweight","measurements","compare"] },
  { to: "/portal/nutrition-targets", label: "Nutrition", icon: Apple, keywords: ["nutrition","macros","targets","recipes","meals"] },
  { to: "/portal/community", label: "Crew", icon: UsersRound, keywords: ["crew","feed","rankings","league","rank","leaderboard","hall of strength","community","members","posts"] },
  { to: "/challenges", label: "Challenges", icon: Trophy, keywords: ["challenge","competition","event","bench 225","leaderboard","compete","prize","winnipeg 225"] },
  { to: "/portal/support", label: "Support", icon: HelpCircle, keywords: ["help","support","question","bug","contact"] },
  { to: "/portal/exercises", label: "Exercises", icon: Dumbbell },
  { to: "/portal/tools", label: "Tools", icon: Wrench, keywords: ["calculator","1rm","macro","plate","water","sleep"] },
  { to: "/portal/membership", label: "Membership", icon: CreditCard, keywords: ["billing","subscription","payment","cancel","hold","plan","upgrade"] },
  { to: "/portal/account", label: "Account Settings", icon: Settings },
];

// Members' bottom tabs: Crew in the middle; Support takes Messages' place.
export const selfServeBottomNav: NavItem[] = [
  { to: "/portal", label: "Home", icon: LayoutDashboard },
  { to: "/portal/workouts", label: "Workouts", icon: Activity, activeOn: WORKOUTS_AREA },
  { to: "/portal/community", label: "Crew", icon: UsersRound },
  { to: "/portal/nutrition-targets", label: "Nutrition", icon: Apple },
  { to: "/portal/support", label: "Support", icon: HelpCircle },
];
