import { useEffect, useState } from "react";
import { Keyboard } from "lucide-react";
import { useCleoAccess } from "@/hooks/use-cleo-access";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
      { keys: ["⌘", "B"], label: "Toggle sidebar" },
      { keys: ["⌘", "⇧", "M"], label: "Toggle client preview (POV)" },
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
    heading: "Program builder",
    items: [
      { keys: ["F"], label: "Focus mode on / off" },
      { keys: ["Esc"], label: "Leave focus mode" },
      { keys: ["[", "]"], label: "Previous / next workout (Day view)" },
      { keys: ["⇧", "[", "]"], label: "Previous / next week" },
      { keys: ["1", "–", "5"], label: "Day · Week · Block · Program · Sheet" },
      { keys: ["⌘", "Z"], label: "Undo (⇧ to redo)" },
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

/** The event the command palette (and anything else) sends to open the list. */
export const OPEN_SHORTCUTS_EVENT = "open-keyboard-shortcuts";

/** Open the keyboard-shortcuts list from anywhere (the ⌘K palette's Help row). */
export function openKeyboardShortcuts() {
  try { window.dispatchEvent(new CustomEvent(OPEN_SHORTCUTS_EVENT)); } catch { /* no window */ }
}

/**
 * The shortcuts list with no button of its own: `?` anywhere (outside a text
 * box) or the palette's "Keyboard shortcuts" opens it. The admin header no
 * longer carries a keyboard icon for something used once in a while.
 */
export function KeyboardShortcutsHost() {
  return <KeyboardShortcutsDialog trigger={false} />;
}

export function KeyboardShortcutsButton() {
  return <KeyboardShortcutsDialog trigger />;
}

function KeyboardShortcutsDialog({ trigger }: { trigger: boolean }) {
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
      // the program editor has its own list of keys (program-builder-shortcuts.tsx)
      if (document.querySelector("[data-builder-header]")) return;
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
      {trigger && (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <button
                type="button"
                aria-label="Keyboard shortcuts"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Keyboard className="h-4 w-4" />
              </button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Keyboard shortcuts{" "}
            <span className="ml-1 rounded bg-muted px-1 text-[10px] font-semibold">?</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      )}

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4" /> Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>
            Press <Kbd>?</Kbd> anywhere to toggle this panel.
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