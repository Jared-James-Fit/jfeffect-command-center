import { Button } from "@/components/ui/button";

export function StickyMobileCta({ label, onClick, href }: { label: string; onClick?: () => void; href?: string }) {
  const inner = (
    <Button size="lg" onClick={onClick} className="h-12 w-full text-base font-bold shadow-2xl shadow-primary/30">
      {label}
    </Button>
  );
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-3 backdrop-blur md:hidden">
      {href ? <a href={href}>{inner}</a> : inner}
    </div>
  );
}