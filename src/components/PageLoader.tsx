export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <section className="card page-loader" aria-busy="true" aria-live="polite">
      <span className="spinner" />
      <p className="muted">{label}</p>
    </section>
  )
}
