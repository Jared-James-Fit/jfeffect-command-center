import type { ReactNode } from "react";

/**
 * Shared frame for the sign-in screens: quiet background, centred column,
 * safe-area aware (notch / home indicator) and keyboard friendly (dvh).
 */
export function AuthShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <main
      className="relative flex min-h-dvh flex-col overflow-hidden bg-background text-foreground"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* Barely-there brand glow, top only — keeps the screen calm. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px]"
        style={{ background: "radial-gradient(60% 100% at 50% 0%, color-mix(in oklab, var(--primary) 9%, transparent), transparent 100%)" }}
      />
      <div className="relative flex flex-1 flex-col items-center justify-center px-6 py-10">
        <div className="jf-auth-rise w-full max-w-[380px]">{children}</div>
      </div>
      {footer && <div className="relative px-6 pb-5 text-center">{footer}</div>}
    </main>
  );
}

/** App-icon style logo, like an iOS home-screen icon. */
export function AuthLogo({ size = 76 }: { size?: number }) {
  return (
    <img
      src="/logo.png"
      alt="JF Effect"
      width={size}
      height={size}
      fetchPriority="high"
      decoding="async"
      className="mx-auto select-none shadow-[0_10px_30px_-10px_color-mix(in_oklab,var(--primary)_55%,transparent),0_2px_6px_rgba(0,0,0,0.12)]"
      style={{ width: size, height: size, borderRadius: size * 0.2237 }}
      draggable={false}
    />
  );
}
