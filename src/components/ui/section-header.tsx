import { cn } from "@/lib/utils";

type SectionHeaderVariant =
  | "default"
  | "press-conference"
  | "social"
  | "shows"
  | "rankings"
  | "recruiting"
  | "carousel"
  | "offseason";

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  className?: string;
  variant?: SectionHeaderVariant;
}

export function SectionHeader({
  title,
  subtitle,
  className,
  variant = "default",
}: SectionHeaderProps) {
  if (variant === "press-conference") {
    // Podium/byline format — reporter credential card feel
    return (
      <div className={cn("mb-4", className)}>
        <div className="flex items-baseline gap-3">
          <span className="font-sans text-[10px] uppercase tracking-widest text-dw-accent">
            Live
          </span>
          <div className="h-px flex-1 bg-dw-accent/40" />
        </div>
        <h2 className="mt-2 font-headline text-2xl uppercase tracking-wider text-ink">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1 font-serif italic text-sm text-ink3">{subtitle}</p>
        )}
      </div>
    );
  }

  if (variant === "social") {
    // Ticker / feed-style header — energetic, tight
    return (
      <div className={cn("mb-4", className)}>
        <div className="flex items-center gap-3">
          <h2 className="font-headline text-xl uppercase tracking-widest text-ink">
            {title}
          </h2>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-dw-green animate-pulse" />
            <span className="font-sans text-[10px] uppercase tracking-widest text-dw-green">
              Live Feed
            </span>
          </span>
        </div>
        <div className="mt-1.5 h-px w-full bg-dw-border" />
        {subtitle && (
          <p className="mt-2 font-serif italic text-sm text-ink3">{subtitle}</p>
        )}
      </div>
    );
  }

  if (variant === "shows") {
    // Broadcast / on-air feel
    return (
      <div className={cn("mb-4", className)}>
        <div className="flex items-baseline justify-between">
          <h2 className="font-headline text-lg uppercase tracking-wider text-ink">
            {title}
          </h2>
          <span className="font-sans text-[10px] uppercase tracking-widest text-ink3">
            On Air
          </span>
        </div>
        <div className="mt-1 h-px w-full bg-dw-border" />
        {subtitle && (
          <p className="mt-2 font-serif italic text-sm text-ink2">{subtitle}</p>
        )}
      </div>
    );
  }

  if (variant === "rankings") {
    // Big numerals / committee-board feel
    return (
      <div className={cn("mb-4", className)}>
        <div className="flex items-baseline gap-4">
          <span className="font-headline text-5xl font-bold leading-none text-dw-accent/20 select-none">
            #
          </span>
          <div className="flex-1">
            <h2 className="font-headline text-lg uppercase tracking-wider text-ink">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 font-serif italic text-sm text-ink3">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        <div className="mt-2 h-px w-full bg-dw-border" />
      </div>
    );
  }

  if (variant === "recruiting") {
    // Insider / scout feel — dashed rule, source tag
    return (
      <div className={cn("mb-4", className)}>
        <div className="flex items-baseline gap-3">
          <h2 className="font-headline text-lg uppercase tracking-wider text-ink">
            {title}
          </h2>
          <span className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">
            On the Trail
          </span>
        </div>
        <div className="mt-1 h-px w-full bg-dw-border" />
        {subtitle && (
          <p className="mt-2 font-serif italic text-sm text-ink3">{subtitle}</p>
        )}
      </div>
    );
  }

  // Default variant
  return (
    <div className={cn("mb-4", className)}>
      <h2 className="font-headline text-lg uppercase tracking-wider text-ink">
        {title}
      </h2>
      <div className="mt-1 h-px w-full bg-dw-border" />
      {subtitle && (
        <p className="mt-2 font-serif italic text-sm text-ink2">{subtitle}</p>
      )}
    </div>
  );
}
