import { useEffect, useState } from "react";
import { Keyboard } from "lucide-react";
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

const SHORTCUT_GROUPS: Group[] = [
  {
    heading: "Global",
    items: [
      { keys: ["?"], label: "Show keyboard shortcuts" },
      { keys: ["⌘", "K"], label: "Open command palette / quick search" },
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

export function KeyboardShortcutsButton() {
  const [open, setOpen] = useState(false);

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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
          {SHORTCUT_GROUPS.map((group) => (
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