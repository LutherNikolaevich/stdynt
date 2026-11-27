// Google Consent Mode v2 for stdynt.
//
// Two rules shape this file:
//   1. Nothing from Google is contacted until the visitor allows analytics, so
//      the "nothing leaves the device" promise holds by default. That makes
//      this basic consent mode: the tag is loaded only after a grant, and its
//      consent state is still declared (default, then update) so the tag it
//      does receive is a compliant one.
//   2. The default is set before the tag exists. A gtag call is just a push
//      onto dataLayer, so the order in this file is the order gtag.js sees.
//
// The measurement ID lives in VITE_GA_ID. With no ID the whole module is a
// no-op: no banner, no script, no dataLayer.

const GA_ID = String(import.meta.env.VITE_GA_ID || '').trim();
const STORAGE_KEY = 'stdynt_consent_v1';
const CHOICES = new Set(['granted', 'denied']);

export const analyticsEnabled = Boolean(GA_ID);

const listeners = new Set();
const gtag = function gtag() {
  window.dataLayer.push(arguments);
};
let loaded = false;

export const getChoice = () => {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return CHOICES.has(value) ? value : null;
  } catch {
    return null;
  }
};

// Consent Mode v2 signals. ads_* stay denied whatever the visitor picks,
// because stdynt runs no advertising tags; only analytics is a real choice.
const signals = (granted) => ({
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: granted ? 'granted' : 'denied',
  functionality_storage: 'granted',
  security_storage: 'granted'
});

const loadTag = () => {
  if (!GA_ID || loaded) return;
  loaded = true;

  // Only now is it worth warming a connection to Google.
  for (const origin of ['https://www.googletagmanager.com', 'https://www.google-analytics.com']) {
    const preconnect = document.createElement('link');
    preconnect.rel = 'preconnect';
    preconnect.href = origin;
    preconnect.crossOrigin = 'anonymous';
    document.head.appendChild(preconnect);
  }

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(script);

  gtag('js', new Date());
  gtag('config', GA_ID, { allow_google_signals: false });
};

export const initConsent = () => {
  if (!GA_ID) return;
  window.dataLayer = window.dataLayer || [];
  const granted = getChoice() === 'granted';
  gtag('consent', 'default', { ...signals(granted), wait_for_update: 500 });
  if (granted) loadTag();
};

export const setChoice = (choice) => {
  if (!CHOICES.has(choice)) throw new Error(`Unknown consent choice: ${choice}`);
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // A blocked localStorage costs the visitor their answer, not the app.
  }
  if (GA_ID) {
    gtag('consent', 'update', signals(choice === 'granted'));
    if (choice === 'granted') loadTag();
  }
  listeners.forEach((fn) => fn(choice));
  return choice;
};

export const subscribeChoice = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
