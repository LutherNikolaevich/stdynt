import React from 'react';
import ReactDOM from 'react-dom/client';
import App, { announceNewBuild } from './App.jsx';
import '@fontsource-variable/bricolage-grotesque/wdth.css';
import './index.css';

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
            background: '#172d24',
            color: '#f5f0e6',
            fontFamily: "'Bricolage Grotesque Variable', system-ui, sans-serif"
          }}
        >
          {}
          <div
            className="card"
            style={{
              maxWidth: '400px',
              background: '#1e3b2f',
              color: '#f5f0e6',
              padding: '24px',
              borderRadius: '16px'
            }}
          >
            <h1 style={{ fontWeight: 700, fontSize: '1.75rem', marginBottom: '8px' }}>
              Something went wrong
            </h1>
            <p style={{ marginBottom: '16px', fontSize: '0.9375rem', color: '#b5bda4' }}>
              {saved
                ? 'stdynt hit a problem it could not recover from. What you saved is still on this device. Save a copy of it before trying anything else.'
                : 'stdynt hit a problem it could not recover from.'}
            </p>
            {}
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

  // A new build took over while this page was open. The page still runs the old code.
  sw.addEventListener('controllerchange', () => {
    if (!hadWorker) return;
    newBuildReady = true;
    announceNewBuild();
  });

  // Anything a reload would throw away: an open sheet, a pending Undo, a field being typed in,
  // or a text field whose value differs from what it was drawn with (an inline edit left half
  // done). Choices (selects, radios, switches) save as they are picked, so they are not checked.
  const TEXT_FIELDS = 'input:not([type=radio]):not([type=checkbox]):not([type=file]), textarea';
  const busy = () =>
    Boolean(document.querySelector('dialog[open], .undo-toast')) ||
    Boolean(document.activeElement?.matches?.('input, select, textarea')) ||
    Array.from(document.querySelectorAll(TEXT_FIELDS)).some(
      // A closed sheet keeps the last entry's values; only fields on screen count.
      (el) => el.value !== el.defaultValue && !el.closest('dialog:not([open])')
    );

  const checkForNewBuild = () => {
    if (!registration) return;
    lastCheck = Date.now();
    registration.update().catch(() => {});
  };

  // An installed app is resumed far more often than it is opened, so it would otherwise
  // never look for a new build or switch to one. Look when it comes back to the front;
  // switch when it goes to the back, where a reload is invisible and nothing is mid-entry.
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
