import type { ReactNode } from "react";

/** A chart plate: title cartouche, one-line purpose, and the datum line (sources, time basis). */
export default function Page({ title, blurb, datum, actions, children, wide = false }: { title: string; blurb: string; datum?: ReactNode; actions?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <main className={`page ${wide ? "page-wide" : ""}`} id="main">
      <header className="plate">
        <div className="plate-title">
          <h1>{title}</h1>
          <p>{blurb}</p>
        </div>
        {actions && <div className="plate-actions">{actions}</div>}
        {datum && <div className="datum">{datum}</div>}
      </header>
      <div className="page-body">{children}</div>
    </main>
  );
}

export function Panel({ title, children, className = "", aside }: { title?: ReactNode; children: ReactNode; className?: string; aside?: ReactNode }) {
  return (
    <section className={`panel ${className}`}>
      {(title || aside) && (
        <div className="panel-head">
          {title && <h2>{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <div className="loading" role="status">
      <span className="sonar" aria-hidden />
      Fetching {what}…
    </div>
  );
}

export function ErrorNote({ error }: { error: string }) {
  return <p className="error-note">{error}</p>;
}
