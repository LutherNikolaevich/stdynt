import React from 'react';
import { ArrowLeft, Settings } from 'lucide-react';

// The one shell every screen renders inside: the header, the rail (a sidebar
// on desktop, the bottom bar on phones) and the content area. Screens only
// supply their content, so they all share the same width and left edge.
export default function Shell({
  view,
  isSettings,
  scrolled,
  dateLabel,
  hideDate = false,
  moneyViews,
  onNavClick,
  onBackClick,
  backHref,
  backLabel,
  fab = null,
  children
}) {
  return (
    <>
      <header className={`topbar ${scrolled ? 'is-scrolled' : ''}`}>
        {isSettings ? (
          <a
            className="icon-btn back-btn"
            href={backHref}
            onClick={onBackClick}
            aria-label={backLabel}
            aria-keyshortcuts="Escape"
            title="Back (Esc)"
          >
            <ArrowLeft size={22} strokeWidth={2} aria-hidden="true" />
          </a>
        ) : (
          <span className="brand">stdynt</span>
        )}
        <span className={hideDate ? 'sr-only' : 'topbar-date'}>{dateLabel}</span>
        {!isSettings && (
          <a
            className="icon-btn settings-btn"
            href="#/settings"
            aria-label="Settings"
            aria-keyshortcuts=","
            title="Settings (,)"
          >
            <Settings size={22} strokeWidth={2} aria-hidden="true" />
          </a>
        )}
      </header>

      <div className="rail">
        {fab}
        <nav className="bottom-nav" aria-label="Money">
          {moneyViews.map(({ id, label, Icon }, i) => (
            <a
              key={id}
              href={`#/${id}`}
              onClick={(e) => onNavClick(e, id)}
              aria-current={view === id ? 'page' : undefined}
              aria-keyshortcuts={String(i + 1)}
              aria-label={label}
            >
              {view === id && <span className="nav-ink" aria-hidden="true" />}
              <span className="nav-icon">
                <Icon size={22} strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="nav-label">{label}</span>
              <kbd className="nav-kbd" aria-hidden="true">{i + 1}</kbd>
            </a>
          ))}
        </nav>
      </div>

      <main className="main">{children}</main>
    </>
  );
}
