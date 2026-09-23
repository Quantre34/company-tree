import { create } from 'zustand';
import { translations, type Lang, type TranslationKey } from './translations';

const STORAGE_KEY = 'companytree.lang';

function detectInitialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'tr' || saved === 'en') return saved;
  } catch { /* private mode / storage blocked — fall back to default */ }
  return 'tr';
}

interface LangState {
  lang: Lang;
  setLang: (l: Lang) => void;
}

export const useLangStore = create<LangState>((set) => ({
  lang: detectInitialLang(),
  setLang: (l) => {
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
    if (typeof document !== 'undefined') document.documentElement.lang = l;
    set({ lang: l });
  },
}));

if (typeof document !== 'undefined') {
  document.documentElement.lang = useLangStore.getState().lang;
}

/**
 * Plain accessor for non-component code (export/pdf.ts, export/xlsx.ts,
 * crypto/vault.ts, persistence/serverVault.ts) that can't use hooks. Named
 * `translate` (not `t`) so it never shadows the many local `t`/`text(t, …)`
 * helper variables already used across the codebase.
 */
export function translate(key: TranslationKey, vars?: Record<string, string | number>): string {
  const dict = translations[useLangStore.getState().lang];
  let str: string = dict[key] ?? translations.tr[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) str = str.split(`{${k}}`).join(String(v));
  return str;
}

/** React hook — subscribes so the component re-renders when the language
 * changes, then returns a `t()` translator closed over the current language. */
export function useT() {
  useLangStore(s => s.lang);
  return translate;
}

export function useLang(): Lang {
  return useLangStore(s => s.lang);
}

/** Locale string for Date.prototype.toLocale*() calls, kept in one place so
 * export code and the on-screen preview stay in sync. */
export function dateLocale(lang: Lang): string {
  return lang === 'en' ? 'en-US' : 'tr-TR';
}
