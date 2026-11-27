import { useEffect, useState } from 'react';
import { analyticsEnabled, getChoice, setChoice, subscribeChoice } from './consent.js';

// Consent is asked once, in the app's own voice, and can be changed later from
// Settings. Rendered only when VITE_GA_ID is configured.
export default function ConsentBanner() {
  const [choice, setLocal] = useState(getChoice);

  useEffect(() => subscribeChoice(setLocal), []);

  if (!analyticsEnabled || choice) return null;

  return (
    <aside className="consent" aria-labelledby="consent-title">
      <p id="consent-title" className="consent-title">
        Share anonymous usage data?
      </p>
      <p className="consent-copy">
        It tells us which screens people use and where stdynt is slow. Your amounts, notes and categories stay on this
        phone.
      </p>
      <div className="consent-actions">
        <button type="button" className="btn ink" onClick={() => setChoice('granted')}>
          Allow
        </button>
        <button type="button" className="btn outline" onClick={() => setChoice('denied')}>
          No thanks
        </button>
      </div>
    </aside>
  );
}

export function ConsentCard() {
  const [choice, setLocal] = useState(getChoice);

  useEffect(() => subscribeChoice(setLocal), []);

  if (!analyticsEnabled) return null;

  return (
    <section className="card pad">
      <h2>Privacy</h2>
      <p className="card-note">
        {choice === 'granted'
          ? 'Anonymous usage data is on. Your amounts, notes and categories never leave this device.'
          : 'Anonymous usage data is off. Nothing is sent to Google Analytics.'}
      </p>
      <div className="btn-row">
        <button
          type="button"
          className={`btn ${choice === 'granted' ? 'ink' : 'outline'}`}
          aria-pressed={choice === 'granted'}
          onClick={() => setChoice('granted')}
        >
          Allow analytics
        </button>
        <button
          type="button"
          className={`btn ${choice === 'denied' ? 'ink' : 'outline'}`}
          aria-pressed={choice === 'denied'}
          onClick={() => setChoice('denied')}
        >
          Don't allow
        </button>
      </div>
    </section>
  );
}
