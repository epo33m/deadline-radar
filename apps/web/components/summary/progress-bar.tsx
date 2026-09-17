/** Solid system-blue fill (no gradient). */
const PROGRESS_FILL = "#0088FF";

type ProgressBarProps = {
  /** Completed amount. Clamped to [0, max]. */
  value: number;
  max?: number;
  /** Accessible name. Defaults to "Overall completion". */
  label?: string;
};

/**
 * Determinate linear progress bar following Apple's HIG:
 * a track that fills from the leading edge as the task completes,
 * non-interactive, with accurate ARIA values.
 */
export function ProgressBar({ value, max = 100, label }: ProgressBarProps) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const clamped = Number.isFinite(value)
    ? Math.min(Math.max(value, 0), safeMax)
    : 0;
  const percent = Math.round((clamped / safeMax) * 100);

  return (
    <div className="w-full">
      <p className="mb-8 text-center text-6xl font-bold text-ink">{percent}%</p>
      <div
        role="progressbar"
        aria-label={label ?? "Overall completion"}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={clamped}
        className="h-6 w-full overflow-hidden rounded-full bg-ink/10"
      >
        <div
          className="h-full rounded-full transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%`, background: PROGRESS_FILL }}
        />
      </div>
    </div>
  );
}
