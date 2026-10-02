import { formatCount } from "@/lib/format";

/** Read-only rating. Stockroom shows ratings but does not take reviews. */
export function Rating({ average, count, className = "" }: { average: number; count: number; className?: string }) {
  const filled = Math.round(average);
  return (
    <p className={`flex items-center gap-1.5 text-sm text-muted ${className}`}>
      <span className="sr-only">
        Rated {average.toFixed(1)} out of 5 from {formatCount(count)} ratings
      </span>
      <span aria-hidden="true" className="tracking-tight text-ink">
        {"★".repeat(filled)}
        <span className="text-line">{"★".repeat(5 - filled)}</span>
      </span>
      <span aria-hidden="true">
        {average.toFixed(1)} ({formatCount(count)})
      </span>
    </p>
  );
}
