import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { feedback } from "@/lib/feedback";
import { useTheme, type ThemePreference } from "@/lib/theme";

/**
 * The one place appearance is chosen (Account → Appearance, for clients,
 * members and staff alike): Light, Dark or System, each with a miniature of
 * the app in that theme. A pick applies and saves at once (setTheme → the
 * account, theme-account-sync); there is no Save and no second switch anywhere.
 */

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/** The previews are drawn with fixed colours (the tokens would show the current theme in all three). */
const PALETTE = {
  light: { page: "#f6f7f8", card: "#ffffff", line: "#d9dce0", ink: "#17181b", soft: "#b9bec6" },
  dark: { page: "#0d0d0f", card: "#1a1a1e", line: "#35353b", ink: "#f4f4f6", soft: "#52525b" },
} as const;

type Palette = (typeof PALETTE)[keyof typeof PALETTE];

function MiniApp({ p }: { p: Palette }) {
  return (
    <div className="absolute inset-0 flex flex-col gap-[5px] p-[7px]" style={{ background: p.page }}>
      {/* top bar: brand mark and a line for the name */}
      <div className="flex items-center gap-[4px]">
        <span className="h-[7px] w-[7px] rounded-[2px] bg-[#e5322d]" />
        <span className="h-[3px] w-[22px] rounded-full" style={{ background: p.ink }} />
      </div>
      {/* a card with two lines and the screen's one main button */}
      <div className="flex flex-col gap-[4px] rounded-[5px] p-[6px]" style={{ background: p.card, boxShadow: `inset 0 0 0 1px ${p.line}` }}>
        <span className="h-[3px] w-[70%] rounded-full" style={{ background: p.ink }} />
        <span className="h-[3px] w-[45%] rounded-full" style={{ background: p.soft }} />
        <span className="mt-[2px] h-[8px] w-full rounded-[3px] bg-[#e5322d]" />
      </div>
      {/* a second, quieter card */}
      <div className="flex flex-col gap-[4px] rounded-[5px] p-[6px]" style={{ background: p.card, boxShadow: `inset 0 0 0 1px ${p.line}` }}>
        <span className="h-[3px] w-[55%] rounded-full" style={{ background: p.ink }} />
        <span className="h-[3px] w-[80%] rounded-full" style={{ background: p.soft }} />
      </div>
      {/* tab bar */}
      <div className="mt-auto flex items-center justify-around border-t pt-[4px]" style={{ borderColor: p.line }}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="h-[4px] w-[4px] rounded-full" style={{ background: i === 0 ? p.ink : p.soft }} />
        ))}
      </div>
    </div>
  );
}

function Preview({ value }: { value: ThemePreference }): ReactNode {
  if (value === "system") {
    // Light on the left, dark on the right, split on a diagonal: the device decides.
    return (
      <>
        <MiniApp p={PALETTE.light} />
        <div className="absolute inset-0" style={{ clipPath: "polygon(58% 0, 100% 0, 100% 100%, 42% 100%)" }}>
          <MiniApp p={PALETTE.dark} />
        </div>
      </>
    );
  }
  return <MiniApp p={PALETTE[value]} />;
}

export function AppearancePicker({ className }: { className?: string }) {
  const { preference, setTheme } = useTheme();
  return (
    <div role="radiogroup" aria-label="Appearance" className={cn("grid grid-cols-3 gap-2.5", className)} data-appearance-picker>
      {OPTIONS.map((o) => {
        const selected = preference === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-appearance-option={o.value}
            onClick={() => {
              if (selected) return;
              feedback("tap");
              setTheme(o.value);
            }}
            className={cn(
              "group flex min-w-0 flex-col gap-2 rounded-xl border p-1.5 text-left outline-none transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              "[-webkit-tap-highlight-color:transparent] active:scale-[0.98]",
              selected ? "border-foreground bg-secondary/60" : "border-border hover:bg-secondary/40",
            )}
          >
            <span className="relative block aspect-[4/5] w-full overflow-hidden rounded-lg ring-1 ring-black/10 dark:ring-white/10" aria-hidden>
              <Preview value={o.value} />
            </span>
            <span className="flex items-center justify-between gap-1 px-1 pb-0.5 pt-0.5">
              <span className="min-w-0 truncate text-[14px] font-semibold leading-tight">{o.label}</span>
              <span
                aria-hidden
                className={cn(
                  "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border transition-colors",
                  selected ? "border-foreground bg-foreground text-background" : "border-border text-transparent",
                )}
              >
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The titled section the account pages show. */
export function AppearanceSection({ className }: { className?: string }) {
  const { preference } = useTheme();
  return (
    <section className={cn("space-y-3", className)} aria-labelledby="appearance-title" id="appearance" data-appearance-section>
      <div>
        <h2 id="appearance-title" className="text-base font-semibold leading-tight">Appearance</h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {preference === "system"
            ? "Following your device's light or dark setting."
            : "System matches your device. Saved to your account."}
        </p>
      </div>
      <AppearancePicker />
    </section>
  );
}
