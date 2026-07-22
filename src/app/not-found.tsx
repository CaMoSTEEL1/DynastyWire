import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-4 text-center">
      <p className="font-sans text-sm font-medium uppercase tracking-widest text-dw-accent">
        404
      </p>

      <h1
        className={cn(
          "mt-3 font-headline text-4xl uppercase tracking-[0.2em] text-ink",
          "sm:text-5xl"
        )}
      >
        Story Not Found
      </h1>

      <div className="rule-diamond my-6 w-full max-w-xs">
        <span className="diamond" />
      </div>

      <p className="max-w-md font-serif text-base italic text-ink2">
        The page you&apos;re looking for has been pulled from the wire.
      </p>

      <p className="mt-2 font-serif text-sm text-ink3">
        It may have been moved, removed, or never existed in the first place.
      </p>

      <a
        href="/"
        className={cn(
          "mt-8 inline-block rounded bg-dw-accent px-6 py-2.5",
          "font-sans text-sm font-semibold uppercase tracking-wider text-white",
          "transition-colors hover:bg-dw-accent2"
        )}
      >
        Back to the Wire
      </a>
    </div>
  );
}
