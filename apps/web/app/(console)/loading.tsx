// Shown while a console page reads from the API: the shape of a page, so nothing jumps when it arrives.
export default function Loading() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading</span>
      <div className="skeleton h-3 w-28" />
      <div className="skeleton mt-3 h-9 w-80 max-w-full" />
      <div className="skeleton mt-3 h-4 w-[34rem] max-w-full" />
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-28" />
        ))}
      </div>
      <div className="skeleton mt-6 h-64" />
    </div>
  );
}
