import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function StickyMobileCta({ label, onClick, href, disabled, paused }: { label: string; onClick?: () => void; href?: string; disabled?: boolean; paused?: boolean }) {
  const inner = (
    <Button
      size="lg"
      onClick={onClick}
      disabled={disabled}
      variant={paused ? "secondary" : "default"}
      className={cn(
        "h-12 w-full text-base font-bold",
        paused ? "opacity-90" : "shadow-2xl shadow-primary/30",
      )}
    >
      {label}
    </Button>
  );
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-3 backdrop-blur md:hidden"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
    >
      {href ? <a href={href}>{inner}</a> : inner}
    </div>
  );
}