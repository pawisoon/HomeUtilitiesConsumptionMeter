/// Text the Worker itself renders: the login screen and the errors it answers
/// with. The dashboard has its own dictionary in public/i18n.js; this one
/// covers everything a visitor can see before that file loads.

export type Lang = "pl" | "en";

export interface Messages {
  locale: string;
  loginTitle: string;
  brand: string;
  tagline: string;
  password: string;
  signIn: string;
  signingIn: string;
  signInFailed: string;
  offline: string;
  badPassword: string;
  badRequest: string;
  tooMany: string;
}

export const MESSAGES: Record<Lang, Messages> = {
  pl: {
    locale: "pl-PL",
    loginTitle: "Liczniki — logowanie",
    brand: "Liczniki",
    tagline: "Zużycie mediów w domu",
    password: "Hasło rodzinne",
    signIn: "Zaloguj",
    signingIn: "Sprawdzam…",
    signInFailed: "Nie udało się zalogować.",
    offline: "Brak połączenia z internetem.",
    badPassword: "Nieprawidłowe hasło.",
    badRequest: "Nieprawidłowe dane.",
    tooMany: "Za dużo prób. Spróbuj ponownie za 15 minut.",
  },
  en: {
    locale: "en-GB",
    loginTitle: "Meters — login",
    brand: "Meters",
    tagline: "Home utility consumption",
    password: "Family password",
    signIn: "Log in",
    signingIn: "Checking…",
    signInFailed: "Login failed.",
    offline: "No internet connection.",
    badPassword: "Incorrect password.",
    badRequest: "Incorrect details.",
    tooMany: "Too many attempts. Please try again in 15 minutes.",
  },
};

export function isLang(value: string): value is Lang {
  return value === "pl" || value === "en";
}

/** Language this deployment speaks, from the LANGUAGE var, Polish by default. */
export function langOf(raw: string | undefined): Lang {
  const code = (raw ?? "pl").trim().toLowerCase();
  return isLang(code) ? code : "pl";
}
