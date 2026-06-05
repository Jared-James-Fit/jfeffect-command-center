import { Loader2 } from "lucide-react";

export function AuthSplash({ message = "Opening your coaching dashboard…" }: { message?: string }) {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-primary/8 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-40 -left-40 h-[500px] w-[500px] rounded-full bg-primary/5 blur-[120px]" />
      <div className="relative flex flex-col items-center gap-5">
        <img src="/logo.png" alt="JF Effect" className="h-16 w-16 rounded-2xl shadow-glow animate-pulse" />
        <div className="flex flex-col items-center gap-2">
          <span className="text-base font-black tracking-[0.2em] uppercase">JF Effect</span>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>{message}</span>
          </div>
        </div>
      </div>
    </main>
  );
}
