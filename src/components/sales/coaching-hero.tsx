import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A real screenshot of the app in a plain phone frame. The screenshots are
 * whole iPhone screens (390×844 at 2x, status bar included), so the frame only
 * adds the bezel and the island; nothing in the picture is drawn by hand.
 */
export function PhoneShot({
  src,
  alt,
  priority = false,
  className,
}: {
  src: string;
  alt: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative mx-auto aspect-[390/844] w-full rounded-[2.4rem] bg-[#0d0d0f] p-[6px] ring-1 ring-black/15 shadow-[0_28px_56px_-28px_rgba(0,0,0,0.5)] dark:ring-white/15",
        className,
      )}
    >
      <img
        src={src}
        alt={alt}
        width={390}
        height={844}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        className="h-full w-full rounded-[2.05rem] object-cover"
      />
      <span aria-hidden className="absolute left-1/2 top-[2.2%] h-[4.4%] w-[31%] -translate-x-1/2 rounded-full bg-black" />
    </div>
  );
}

export function CoachingHero({
  eyebrow,
  headline,
  sub,
  primary,
  note,
  image,
}: {
  eyebrow?: string;
  headline: string;
  sub: string;
  primary: ReactNode;
  note?: string;
  image: { src: string; alt: string };
}) {
  return (
    <section className="mx-auto grid max-w-5xl gap-10 px-5 pb-12 pt-6 md:pb-16 md:pt-16 lg:grid-cols-[1.15fr_.85fr] lg:items-center">
      <div className="jf-auth-rise text-center lg:text-left">
        {eyebrow && <div className="text-[13px] font-semibold text-muted-foreground">{eyebrow}</div>}
        <h1 className="mx-auto mt-3 max-w-[17ch] text-balance text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] md:text-[60px] lg:mx-0">
          {headline}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-[18px] leading-relaxed text-muted-foreground md:text-[19px] lg:mx-0">{sub}</p>
        <div className="mt-7 flex flex-col items-stretch sm:items-center lg:items-start">{primary}</div>
        {note && <p className="mt-3 text-[13px] text-muted-foreground">{note}</p>}
      </div>
      <PhoneShot src={image.src} alt={image.alt} priority className="max-w-[250px] md:max-w-[290px]" />
    </section>
  );
}
