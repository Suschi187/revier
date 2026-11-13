/** Ladeplatzhalter einer Anzeigenkarte (Styleguide „Laden“): Flächen in Sand, Pulsieren nur ohne reduzierte Bewegung. */
export function SkeletonCard({ label }: { label: string }) {
  const bar = "rounded-btn bg-sand motion-safe:animate-pulse";
  return (
    <div aria-busy="true" aria-label={label} role="status" className="flex flex-col gap-2.5 rounded-card border border-sand bg-surface p-3">
      <span className={`${bar} aspect-photo w-full`} />
      <span className={`${bar} h-3 w-1/2`} />
      <span className={`${bar} h-4 w-5/6`} />
      <span className={`${bar} h-4 w-1/3`} />
    </div>
  );
}
