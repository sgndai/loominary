import React, { useState, useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import WelcomePage from './WelcomePage';

import enTranslations from './langs/en.json';
import zhTranslations from './langs/zh.json';

const TRANSLATIONS = {
  en: enTranslations,
  zh: zhTranslations,
};

const DEFAULT_LANG = 'zh';
const VIEWER_LANGUAGE_KEY = 'loominary_language';

function normalizeLanguage(lang) {
  return TRANSLATIONS[lang] ? lang : null;
}

function readLegacyLocalLanguage() {
  try {
    for (const key of [VIEWER_LANGUAGE_KEY, 'loominary_lang', 'exporterLanguage']) {
      const value = normalizeLanguage(localStorage.getItem(key));
      if (value) return value;
    }
  } catch (_) {}
  return null;
}

function persistViewerLanguage(lang) {
  const normalized = normalizeLanguage(lang);
  if (!normalized) return DEFAULT_LANG;
  try {
    localStorage.setItem(VIEWER_LANGUAGE_KEY, normalized);
  } catch (_) {}
  return normalized;
}

// Language is read once from chrome.storage at startup (set there by the userscript)
// setResolvedLang allows the App to switch language after a postMessage payload arrives.
let resolvedLang = DEFAULT_LANG;
let _langListeners = [];
export function setResolvedLang(lang) {
  const next = normalizeLanguage(lang) || DEFAULT_LANG;
  if (next === resolvedLang) return;
  resolvedLang = next;
  _langListeners.forEach(fn => fn(next));
}

export function setViewerLanguage(lang) {
  const next = persistViewerLanguage(lang);
  setResolvedLang(next);
}

export function getViewerLanguage() {
  return readLegacyLocalLanguage() || DEFAULT_LANG;
}
export function subscribeLang(fn) {
  _langListeners.push(fn);
  return () => { _langListeners = _langListeners.filter(f => f !== fn); };
}

function getNestedValue(obj, path) {
  return path.split('.').reduce((cur, key) => (cur && typeof cur === 'object' ? cur[key] : undefined), obj);
}

function interpolate(text, params = {}) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in params ? params[key] : match));
}

// Non-React translation function (used by markdownExporter etc.)
export function t(key, params = {}) {
  const pack = TRANSLATIONS[resolvedLang] || TRANSLATIONS[DEFAULT_LANG];
  const val = getNestedValue(pack, key);
  if (val === undefined || val === null) return interpolate(key.split('.').pop(), params);
  if (typeof val === 'string') return interpolate(val, params);
  return val;
}

export const useI18n = () => {
  const [lang, setLang] = useState(() => resolvedLang);
  useEffect(() => subscribeLang(setLang), []);
  const translations = TRANSLATIONS[lang] || TRANSLATIONS[DEFAULT_LANG];

  const tHook = useCallback((key, params = {}) => {
    const val = getNestedValue(translations, key);
    if (val === undefined || val === null) return interpolate(key.split('.').pop(), params);
    if (typeof val === 'string') return interpolate(val, params);
    return val;
  }, [translations]);

  return { t: tHook, currentLanguage: lang };
};

// =============================================================================
// React 应用启动：先读语言再渲染
// =============================================================================

const isWelcomePage = window.location.pathname.endsWith('/welcome') || window.location.pathname.endsWith('/welcome/')
  || window.location.hash === '#/welcome';

function boot(lang) {
  resolvedLang = TRANSLATIONS[lang] ? lang : DEFAULT_LANG;
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(
    <React.StrictMode>
      {isWelcomePage ? <WelcomePage /> : <App />}
    </React.StrictMode>
  );
}

// eslint-disable-next-line no-undef
const chromeApi = typeof chrome !== 'undefined' ? chrome : null;

const storedViewerLanguage = readLegacyLocalLanguage();

if (storedViewerLanguage) {
  persistViewerLanguage(storedViewerLanguage);
  boot(storedViewerLanguage);
} else if (chromeApi && chromeApi.storage && chromeApi.storage.local) {
  // One-time migration source for existing extension installs. The canonical
  // preference thereafter lives in loominary_language.
  chromeApi.storage.local.get('loominary_lang', (result) => {
    const migrated = normalizeLanguage(result.loominary_lang) || DEFAULT_LANG;
    persistViewerLanguage(migrated);
    boot(migrated);
  });
} else {
  persistViewerLanguage(DEFAULT_LANG);
  boot(DEFAULT_LANG);
}
