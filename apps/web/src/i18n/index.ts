import { en } from "./messages/en";
import { es } from "./messages/es";

// Lightweight i18n: typed flat catalogs (messages/*.ts), `{name}`
// interpolation, `_one`/`_other` plurals via Intl.PluralRules, and
// locale-aware number formatting via Intl.NumberFormat. Adding a language
// = one catalog file typed as `Messages` plus an entry in LANGUAGES.

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

// Base names of pluralised keys ("sidebar.summary" for "sidebar.summary_one").
type PluralBase<K> = K extends `${infer B}_${"one" | "other"}` ? B : never;
export type TranslationKey = MessageKey | PluralBase<MessageKey>;

export const LANGUAGES = {
  es: { label: "Español", locale: "es-ES", messages: es },
  en: { label: "English", locale: "en-GB", messages: en },
} as const satisfies Record<string, { label: string; locale: string; messages: Messages }>;

export type Language = keyof typeof LANGUAGES;
export const DEFAULT_LANGUAGE: Language = "es";

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && value in LANGUAGES;
}

export interface I18n {
  lang: Language;
  locale: string;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  // Whether a (dynamically built) key exists, e.g. an unknown API subtype.
  has: (key: string) => boolean;
  fmtInt: (n: number) => string;
  fmtDecimal: (n: number, digits?: number) => string;
  fmtPct: (p: number | null) => string;
  fmtMeur: (meur: number) => string;
}

export function createI18n(lang: Language): I18n {
  const { locale, messages } = LANGUAGES[lang];
  const catalog = messages as Record<string, string>;
  const plural = new Intl.PluralRules(locale);
  const int = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const oneDecimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const pct = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1, minimumFractionDigits: 1 });

  const t: I18n["t"] = (key, vars) => {
    let template = catalog[key];
    if (template === undefined && typeof vars?.count === "number") {
      template = catalog[`${key}_${plural.select(vars.count)}`] ?? catalog[`${key}_other`];
    }
    if (template === undefined) return key;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = vars?.[name];
      if (value === undefined) return match;
      return typeof value === "number" ? number.format(value) : value;
    });
  };

  return {
    lang,
    locale,
    t,
    has: (key) => key in catalog,
    fmtInt: (n) => int.format(n),
    fmtDecimal: (n, digits = 1) =>
      new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n),
    fmtPct: (p) => (p === null ? "—" : pct.format(p / 100)),
    fmtMeur: (meur) => `${meur >= 100 ? int.format(meur) : oneDecimal.format(meur)} M€`,
  };
}
