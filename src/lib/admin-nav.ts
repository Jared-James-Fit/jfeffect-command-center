import {
  LayoutDashboard, CreditCard, Package, Dumbbell, Calendar,
  Settings, Apple, MessageCircle, BookOpen,
  Activity, Wrench, HelpCircle, Trophy, UsersRound, Target, Camera,
} from "lucide-react";
import type { NavItem } from "@/components/app-shell";

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
  { to: "/portal/challenges", label: "Challenges", icon: Trophy, keywords: ["challenges","competition","events","winnipeg 225","bench challenge","leaderboard","prizes","my results"] },
  { to: "/portal/exercises", label: "Exercises", icon: Dumbbell },
  { to: "/portal/purchases", label: "My Purchases", icon: Package },
  // The Coaching Agreement is a section of Account (the old Agreements page lands there).
  { to: "/portal/account", label: "Account Settings", icon: Settings, keywords: ["account","settings","agreement","coaching agreement","contract","signed","password","units","notifications","privacy"] },
];

// Mobile bottom-tab nav for the client portal: five destinations, Crew as the
// raised centre (trophy) button: Feed · Rankings inside, with a ring and a
// count when there are new posts. "More" opens from the top bar instead (AppShell `moreInHeader`).
// Messages sits right after Crew (the coach is one thumb-reach away) and
// Nutrition takes the far right.
export const clientBottomNav: NavItem[] = [
  { to: "/portal", label: "Home", icon: LayoutDashboard },
  { to: "/portal/workouts", label: "Workouts", icon: Activity },
  { to: "/portal/community", label: "Crew", icon: UsersRound, featured: true,
    // the satellite on Crew's button: straight to Rankings (the League)
    shortcut: { to: "/portal/community", hash: "rankings", label: "Rankings", icon: Trophy } },
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
  { to: "/portal/programs", label: "Programs", icon: BookOpen, keywords: ["plans","programs","library","start","training","build","builder","share","copy","routines"] },
  { to: "/portal/plans", label: "JF Effect plans", icon: BookOpen, keywords: ["plans","library","coach-written","start"] },
  { to: "/portal/progress", label: "Progress", icon: Camera, keywords: ["progress","photos","videos","bodyweight","measurements","compare"] },
  { to: "/portal/nutrition-targets", label: "Nutrition", icon: Apple, keywords: ["nutrition","macros","targets","recipes","meals"] },
  { to: "/portal/community", label: "Crew", icon: UsersRound, keywords: ["crew","feed","rankings","league","rank","leaderboard","hall of strength","community","members","posts"] },
  { to: "/portal/challenges", label: "Challenges", icon: Trophy, keywords: ["challenges","competition","events","winnipeg 225","bench challenge","leaderboard","prizes","my results"] },
  { to: "/portal/support", label: "Support", icon: HelpCircle, keywords: ["help","support","question","bug","contact"] },
  { to: "/portal/exercises", label: "Exercises", icon: Dumbbell },
  { to: "/portal/tools", label: "Tools", icon: Wrench, keywords: ["calculator","1rm","macro","plate","water","sleep"] },
  { to: "/portal/membership", label: "Membership", icon: CreditCard, keywords: ["billing","subscription","payment","cancel","hold","plan","upgrade"] },
  { to: "/portal/account", label: "Account Settings", icon: Settings },
];

// Members' bottom tabs: Crew stays the raised centre; Support takes Messages' place.
export const selfServeBottomNav: NavItem[] = [
  { to: "/portal", label: "Home", icon: LayoutDashboard },
  { to: "/portal/workouts", label: "Workouts", icon: Activity },
  { to: "/portal/community", label: "Crew", icon: UsersRound, featured: true,
    shortcut: { to: "/portal/community", hash: "rankings", label: "Rankings", icon: Trophy } },
  { to: "/portal/nutrition-targets", label: "Nutrition", icon: Apple },
  { to: "/portal/support", label: "Support", icon: HelpCircle },
];
