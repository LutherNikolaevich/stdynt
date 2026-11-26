import './font.css';
import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App, { announceNewBuild } from './App.jsx';

// Critical styles are inlined in the document. The rest of the app's CSS is
// linked with media="print" so the browser fetches it without blocking the
// first paint; switching the media to "all" applies it once the shell is up.
document.querySelector('link[data-deferred-css]')?.setAttribute('media', 'all');

for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (event) => event.preventDefault());
}

// A long press on a touch screen asks the browser for its own menu — text
// selection, "open link in new tab", save image — which covers the app even
// when the text itself is not selectable. Keep the menu on text fields, where
// it is the paste and cursor UI, and leave mouse right clicks alone.
const TEXT_ENTRY = 'input, textarea, select, [contenteditable], [contenteditable] *';
document.addEventListener('contextmenu', (event) => {
  if (event.pointerType === 'mouse') return;
  if (event.target instanceof Element && event.target.closest(TEXT_ENTRY)) return;
  event.preventDefault();
});

const readSaved = () => {
  try {
    return localStorage.getItem('stdynt_data_v1');
  } catch {
    return null;
  }
};

const saveCopy = (text) => {
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `stdynt-data-copy-${day}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
};

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('App crash caught by ErrorBoundary:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      const saved = readSaved();
      return (
        <div
          style={{
            minHeight: '100dvh',
            display: 'grid',
            placeItems: 'center',
            padding: '24px',
            background: 'oklch(28% 0.037 166deg)',
            color: 'oklch(96% 0.017 92deg)',
            fontFamily: "'Bricolage Grotesque Variable', system-ui, sans-serif"
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: '400px',
              background: 'oklch(32% 0.042 166deg)',
              color: 'oklch(96% 0.017 92deg)',
              padding: '24px',
              borderRadius: '16px'
            }}
          >
            <h1 style={{ fontWeight: 700, fontSize: '1.75rem', marginBottom: '8px' }}>
              Something went wrong
            </h1>
            <p style={{ marginBottom: '16px', fontSize: '0.9375rem', color: 'oklch(83% 0.03 110deg)' }}>
              {saved
                ? 'stdynt hit a problem it could not recover from. What you saved is still on this device. Save a copy of it before trying anything else.'
                : 'stdynt hit a problem it could not recover from.'}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {saved && (
                <button type="button" className="btn ink" onClick={() => saveCopy(saved)}>
                  Save a copy of my data
                </button>
              )}
              <button type="button" className={`btn ${saved ? 'outline' : 'ink'}`} onClick={() => window.location.reload()}>
                Reload stdynt
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const sw = navigator.serviceWorker;
  const UPDATE_CHECK_MS = 5 * 60 * 1000;
  const hadWorker = Boolean(sw.controller);
  let registration = null;
  let lastCheck = Date.now();
  let newBuildReady = false;

  sw.addEventListener('controllerchange', () => {
    if (!hadWorker) return;
    newBuildReady = true;
    announceNewBuild();
  });

  const TEXT_FIELDS = 'input:not([type=radio]):not([type=checkbox]):not([type=file]), textarea';
  const busy = () =>
    Boolean(document.querySelector('dialog[open], .undo-toast')) ||
    Boolean(document.activeElement?.matches?.('input, select, textarea')) ||
    Array.from(document.querySelectorAll(TEXT_FIELDS)).some(
      (el) => el.value !== el.defaultValue && !el.closest('dialog:not([open])')
    );

  const checkForNewBuild = () => {
    if (!registration) return;
    lastCheck = Date.now();
    registration.update().catch(() => {});
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (newBuildReady && !busy()) window.location.reload();
      return;
    }
    if (Date.now() - lastCheck >= UPDATE_CHECK_MS) checkForNewBuild();
  });

  setInterval(() => {
    if (document.visibilityState === 'visible') checkForNewBuild();
  }, UPDATE_CHECK_MS);

  window.addEventListener('load', () => {
    sw.register('./sw.js')
      .then((reg) => {
        registration = reg;
      })
      .catch((err) => {
        console.warn('SW registration failed:', err);
      });
  });
}
