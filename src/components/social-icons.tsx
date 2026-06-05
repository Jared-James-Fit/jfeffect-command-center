import { clientSocials, displayHandle } from "@/lib/social-handles";
import { cn } from "@/lib/utils";

export function SocialIcons({
  client,
  size = "sm",
  className,
}: {
  client: Record<string, any> | null | undefined;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const socials = clientSocials(client);
  if (!socials.length) return null;

  const iconClass = size === "xs" ? "h-3 w-3" : size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
  const btnClass =
    size === "xs" ? "h-6 w-6" : size === "md" ? "h-8 w-8" : "h-7 w-7";

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {socials.map(({ platform, value, url }) => {
        const Icon = platform.icon;
        const title =
          platform.key === "other"
            ? `${(client as any)?.other_social_label || "Other"}: ${value}`
            : `${platform.label}: ${displayHandle(platform.key, value)}`;
        const baseCls = cn(
          "inline-flex items-center justify-center rounded-md border border-border bg-secondary/40 text-foreground transition hover:border-primary hover:text-primary",
          btnClass,
        );
        if (url) {
          return (
            <a
              key={platform.key}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title={title}
              aria-label={title}
              className={baseCls}
            >
              <Icon className={iconClass} />
            </a>
          );
        }
        return (
          <span key={platform.key} title={title} aria-label={title} className={cn(baseCls, "cursor-default opacity-80")}>
            <Icon className={iconClass} />
          </span>
        );
      })}
    </div>
  );
}