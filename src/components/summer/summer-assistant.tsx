/**
 * Cleo in admin (Nov 24 2026): one panel, mounted once in the admin layout for
 * whoever has Cleo, that never resets (cleo-panel.tsx). It opens from the Cleo
 * button in the shell's bar, Cleo's row in Messages (tap to type, the mic to
 * dictate), ⌘/Ctrl+Shift+S, "/admin#cleo" (Cleo's approval and decision
 * pushes) and the window events other screens use ("summer:open",
 * "summer:toggle", "summer:close"; detail in cleo-open.ts).
 *
 * No floating button of its own: the panel is drawn only while it's open.
 */
import { CleoPanel } from "@/components/cleo/cleo-panel";

export { openSummer, type SummerOpenDetail } from "@/lib/cleo-open";

export function SummerAssistant() {
  return <CleoPanel />;
}
