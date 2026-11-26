// The real sound + haptic engine, bundled for a real browser (run.cjs).
import * as sounds from "@/lib/app-sounds";
import * as fb from "@/lib/feedback";
import * as haptics from "@/platform/haptics";
(window as any).__sounds = sounds;
(window as any).__fb = fb;
(window as any).__haptics = haptics;
