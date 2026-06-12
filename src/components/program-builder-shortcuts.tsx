import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PREF_KEY = "pb.shortcuts.enabled";

export function pbShortcutsEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const v = window.localStorage.getItem(PREF_KEY);
  return v == null ? true : v === "1";
}

function isMac(): boolean {
  if (typeof navigator === "undefined") return true;
  const p = (navigator as any).userAgentData?.platform ?? navigator.platform ?? "";
  return /Mac|iPhone|iPad|iPod/i.test(p);
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground shadow-sm">
      {children}
    </kbd>
  );
}

function KeyCombo({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((k, i) => (
        <Kbd key={i}>{k}</Kbd>
      ))}
    </span>
  );
}

type ShortcutRow = { label: string; combos: string[][] };
type ShortcutGroup = { heading: string; items: ShortcutRow[] };

function buildShortcuts(mac: boolean): ShortcutGroup[] {
  const mod = mac ? "⌘" : "Ctrl";
  const alt = mac ? "⌥" : "Alt";
  const del = mac ? "Delete" : "Backspace";
  return [
    {
      heading: "Exercise Search",
      items: [
        { label: "Open search", combos: [["/"], [mod, "K"]] },
        { label: "Close search", combos: [["Esc"]] },
        { label: "Clear search", combos: [[mod, del]] },
        { label: "Refresh results", combos: [[alt, "R"]] },
      ],
    },
    {
      heading: "General",
      items: [
        { label: "Open shortcut legend", combos: [["?"]] },
        { label: "Close active panel", combos: [["Esc"]] },
      ],
    },
  ];
}

/**
 * Global keyboard shortcuts for the Program Builder.
 * Communicates with `ExerciseLibraryPanel` via window CustomEvents:
 *   - pb:focus-search   → focus & expand search
 *   - pb:clear-search   → clear query
 *   - pb:close-search   → blur input
 */
export function ProgramBuilderShortcutsButton({ className }: { className?: string }) {
  const qc = useQueryClient();
  const [mac, setMac] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [legendOpen, setLegendOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMac(isMac());
    setEnabled(pbShortcutsEnabled());
  }, []);

  const setPref = (v: boolean) => {
    setEnabled(v);
    try {
      window.localStorage.setItem(PREF_KEY, v ? "1" : "0");
    } catch {}
  };

  const refreshExercises = useCallback(async () => {
    const tid = toast.loading("Refreshing exercises...");
    try {
      await qc.invalidateQueries({ queryKey: ["exercises-min"] });
      await qc.refetchQueries({ queryKey: ["exercises-min"] });
      toast.success("Exercise library refreshed", { id: tid });
    } catch {
      toast.error("Couldn't refresh exercises", {
        id: tid,
        action: { label: "Retry", onClick: () => void refreshExercises() },
      });
    }
  }, [qc]);

  const openLegend = useCallback(() => {
    returnFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    setLegendOpen(true);
  }, []);

  // Global key listener
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const typing = isTypingTarget(e.target);

      // Esc — always allowed (closes legend / search)
      if (e.key === "Escape") {
        if (legendOpen) {
          // Dialog handles its own close; nothing else.
          return;
        }
        // Let the search input handle its own Esc; outside, close search panel.
        if (!typing) {
          window.dispatchEvent(new CustomEvent("pb:close-search"));
        }
        return;
      }

      if (typing) return;

      // Don't fire while a modal/dialog is open (except our legend, which we handle).
      const hasOpenDialog =
        document.querySelector('[role="dialog"][data-state="open"]') != null;
      if (hasOpenDialog && !legendOpen) return;

      const mod = e.metaKey || e.ctrlKey;
      const isAlt = e.altKey;

      // ? — open legend
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        openLegend();
        return;
      }

      // / — focus search
      if (e.key === "/" && !mod && !isAlt) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("pb:focus-search"));
        return;
      }

      // Cmd/Ctrl + K — focus search
      if (mod && !isAlt && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("pb:focus-search"));
        return;
      }

      // Cmd/Ctrl + Delete/Backspace — clear search
      if (mod && !isAlt && (e.key === "Backspace" || e.key === "Delete")) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("pb:clear-search"));
        return;
      }

      // Alt/Option + R — refresh
      if (isAlt && !mod && (e.key === "r" || e.key === "R" || e.key === "®")) {
        e.preventDefault();
        void refreshExercises();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, legendOpen, openLegend, refreshExercises]);

  // Return focus when legend closes
  useEffect(() => {
    if (!legendOpen && returnFocusRef.current) {
      const el = returnFocusRef.current;
      returnFocusRef.current = null;
      setTimeout(() => el?.focus?.(), 0);
    }
  }, [legendOpen]);

  const mod = mac ? "⌘" : "Ctrl";
  const alt = mac ? "⌥" : "Alt";
  const del = mac ? "Delete" : "Backspace";
  const groups = buildShortcuts(mac);

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            ref={buttonRef}
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Keyboard Shortcuts"
            title="Keyboard Shortcuts (?)"
            onClick={openLegend}
            className={cn("h-7 w-7 text-muted-foreground hover:text-foreground", className)}
          >
            <Keyboard className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="bottom"
          className="w-72 p-3 text-xs"
          // Don't steal focus on hover-open
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Keyboard className="h-3.5 w-3.5" /> Shortcuts
          </div>
          <ul className="space-y-1.5">
            <li className="flex items-center justify-between gap-2">
              <span>Open search</span>
              <span className="flex items-center gap-1">
                <KeyCombo keys={["/"]} />
                <span className="text-muted-foreground">or</span>
                <KeyCombo keys={[mod, "K"]} />
              </span>
            </li>
            <li className="flex items-center justify-between gap-2">
              <span>Close search</span>
              <KeyCombo keys={["Esc"]} />
            </li>
            <li className="flex items-center justify-between gap-2">
              <span>Clear search</span>
              <KeyCombo keys={[mod, del]} />
            </li>
            <li className="flex items-center justify-between gap-2">
              <span>Refresh results</span>
              <KeyCombo keys={[alt, "R"]} />
            </li>
            <li className="flex items-center justify-between gap-2">
              <span>View all shortcuts</span>
              <KeyCombo keys={["?"]} />
            </li>
          </ul>
          <Button
            size="sm"
            variant="secondary"
            className="mt-3 h-7 w-full text-[11px]"
            onClick={openLegend}
          >
            View all shortcuts
          </Button>
        </PopoverContent>
      </Popover>

      <Dialog open={legendOpen} onOpenChange={setLegendOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Keyboard className="h-4 w-4" /> Keyboard Shortcuts
            </DialogTitle>
            <DialogDescription>
              Press <Kbd>?</Kbd> anywhere in the Program Builder to toggle this panel.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 space-y-4">
            {groups.map((group) => (
              <div key={group.heading}>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.heading}
                </div>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {group.items.map((row) => (
                    <li
                      key={row.label}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <span className="text-foreground">{row.label}</span>
                      <span className="flex items-center gap-2">
                        {row.combos.map((combo, i) => (
                          <span key={i} className="flex items-center gap-1">
                            {i > 0 && (
                              <span className="text-[10px] text-muted-foreground">or</span>
                            )}
                            <KeyCombo keys={combo} />
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
            <div>
              <div className="font-medium text-foreground">Keyboard shortcuts enabled</div>
              <div className="text-[11px] text-muted-foreground">
                Shortcuts are disabled while typing in form fields.
              </div>
            </div>
            <Switch checked={enabled} onCheckedChange={setPref} aria-label="Toggle keyboard shortcuts" />
          </div>

          <div className="mt-2 flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setLegendOpen(false)} className="gap-1">
              <X className="h-3.5 w-3.5" /> Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}