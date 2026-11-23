import { useEffect, useState } from "react";
import { Keyboard } from "lucide-react";
import { useCleoAccess } from "@/hooks/use-cleo-access";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Anything can open the list (the command palette's "Keyboard shortcuts"). */
export const OPEN_SHORTCUTS_EVENT = "open-keyboard-shortcuts";

type Shortcut = { keys: string[]; label: string };
type Group = { heading: string; items: Shortcut[] };

/** Listed only for someone who has Cleo. */
const CLEO_SHORTCUT = "Open / close Cleo";

const SHORTCUT_GROUPS: Group[] = [
  {
    heading: "Global",
    items: [
      { keys: ["?"], label: "Show keyboard shortcuts" },
      { keys: ["⌘", "K"], label: "Open command palette / quick search" },
      { keys: ["⌘", "⇧", "S"], label: CLEO_SHORTCUT },
      { keys: ["⌘", "⇧", "E"], label: "Open / close all sidebar sections" },
      { keys: ["Esc"], label: "Close dialogs & popovers" },
    ],
  },
  {
    heading: "Navigation (palette)",
    items: [
      { keys: ["↑"], label: "Move up" },
      { keys: ["↓"], label: "Move down" },
      { keys: ["Enter"], label: "Go to selected page" },
    ],
  },
  {
    heading: "Editing",
    items: [
      { keys: ["⌘", "Enter"], label: "Send comment / submit form" },
      { keys: ["⌘", "S"], label: "Save current item (where supported)" },
    ],
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.75rem] items-center justify-center rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-foreground shadow-sm">
      {children}
    </kbd>
  );
}

/**
 * The keyboard shortcuts list, with no button of its own (Nov 23 2026: the
 * desktop header's keyboard icon is gone): "?" anywhere toggles it, and the
 * command palette opens it (OPEN_SHORTCUTS_EVENT). Mounted once for staff
 * pages (AdminTopBar).
 */
export function KeyboardShortcutsHost() {
  const [open, setOpen] = useState(false);
  const cleo = useCleoAccess();
  const groups = cleo
    ? SHORTCUT_GROUPS
    : SHORTCUT_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => i.label !== CLEO_SHORTCUT) }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const isTyping =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (t && (t as HTMLElement).isContentEditable);
      if (isTyping) return;
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4" /> Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>
            Press <Kbd>?</Kbd> anywhere to toggle this list. It's also in the command palette (<Kbd>⌘</Kbd> <Kbd>K</Kbd>).
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-5">
          {groups.map((group) => (
            <div key={group.heading}>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.heading}
              </div>
              <ul className="divide-y divide-border rounded-md border border-border">
                {group.items.map((s) => (
                  <li
                    key={s.label}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span className="text-foreground">{s.label}</span>
                    <span className="flex items-center gap-1">
                      {s.keys.map((k, i) => (
                        <Kbd key={i}>{k}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}