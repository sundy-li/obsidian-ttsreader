import type { TtsReaderVoice } from "./sdk.js";

export type VoiceFilter = "all" | "premium" | "basic";
export type CredentialKind = "none" | "uapi-key" | "cloud-bearer" | "firebase-refresh";
export type CloudCredentialKind = "none" | "cloud-bearer" | "firebase-refresh";

export interface TtsReaderPluginSettings {
  apiKey: string;
  cloudBearerToken: string;
  credential: string;
  firebaseApiKey: string;
  firebaseRefreshToken: string;
  firebaseAccessToken: string;
  firebaseAccessTokenExpiresAt: number;
  preferredVoiceId: string;
  preferredMode: "cloud-playback" | "uapi-export";
  defaultRate: number;
  preferredLanguageCode: string;
  preferredAccentCode: string;
  voiceFilter: VoiceFilter;
  premiumCharsUsed: number;
}

export const DEFAULT_SETTINGS: TtsReaderPluginSettings = {
  apiKey: "",
  cloudBearerToken: "",
  credential: "",
  firebaseApiKey: "",
  firebaseRefreshToken: "",
  firebaseAccessToken: "",
  firebaseAccessTokenExpiresAt: 0,
  preferredVoiceId: "",
  preferredMode: "cloud-playback",
  defaultRate: 1,
  preferredLanguageCode: "en",
  preferredAccentCode: "en-US",
  voiceFilter: "all",
  premiumCharsUsed: 0,
};

export const PREMIUM_CHAR_LIMIT = 5000;
export const AUDIO_CACHE_LIMIT = 16;

export interface VoiceAccentGroup {
  code: string;
  name: string;
  flag: string;
}

export interface VoiceLanguageGroup {
  languageCode: string;
  name: string;
  flag: string;
  accents: VoiceAccentGroup[];
}

export interface VoiceSelectionFilter {
  languageCode: string;
  accentCode: string;
  voiceFilter: VoiceFilter;
}

export interface AudioCacheKeyParts {
  text: string;
  voiceId: string;
  lang: string;
  rate: number;
  mode: TtsReaderPluginSettings["preferredMode"];
  isTest: boolean;
  credentialKind: CredentialKind;
  credentialFingerprint: string;
}

export interface CredentialParts {
  kind: CredentialKind;
  apiKey?: string;
  cloudBearerToken?: string;
  firebaseApiKey?: string;
  firebaseRefreshToken?: string;
  cloudCredentialKind: CloudCredentialKind;
  hasCloudAuth: boolean;
}

export function mergeSettings(settings: Partial<TtsReaderPluginSettings> | null | undefined): TtsReaderPluginSettings {
  const credential = settings?.credential ?? settings?.apiKey ?? settings?.cloudBearerToken ?? "";
  return {
    ...DEFAULT_SETTINGS,
    ...(settings ?? {}),
    credential,
  };
}

export function chooseInitialVoiceId(voices: TtsReaderVoice[], preferredVoiceId?: string): string {
  if (preferredVoiceId && voices.some((voice) => voice.id === preferredVoiceId)) {
    return preferredVoiceId;
  }

  return voices[0]?.id ?? "";
}

export function getReadableText(fullText: string, selectedText?: string): string {
  const selected = selectedText?.trim();
  if (selected) {
    return selected;
  }

  return fullText.trim();
}

export function groupVoicesByLanguage(voices: TtsReaderVoice[]): VoiceLanguageGroup[] {
  const groups = new Map<string, VoiceLanguageGroup>();

  for (const voice of voices) {
    const languageCode = getLanguageCode(voice.lang);
    const accentCode = normalizeLocale(voice.lang);
    if (!languageCode || !accentCode) {
      continue;
    }

    const existing = groups.get(languageCode);
    const group =
      existing ??
      ({
        languageCode,
        name: displayLanguage(languageCode),
        flag: localeFlag(accentCode),
        accents: [],
      } satisfies VoiceLanguageGroup);

    if (!group.accents.some((accent) => accent.code === accentCode)) {
      group.accents.push({
        code: accentCode,
        name: displayRegion(accentCode),
        flag: localeFlag(accentCode),
      });
    }

    groups.set(languageCode, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      accents: group.accents.sort(compareAccents),
      flag: group.accents[0]?.flag ?? group.flag,
    }))
    .sort(compareLanguageGroups);
}

export function filterVoicesForSelection(
  voices: TtsReaderVoice[],
  selection: VoiceSelectionFilter,
): TtsReaderVoice[] {
  return voices.filter((voice) => {
    if (selection.languageCode && getLanguageCode(voice.lang) !== selection.languageCode) {
      return false;
    }
    if (selection.accentCode && normalizeLocale(voice.lang) !== normalizeLocale(selection.accentCode)) {
      return false;
    }
    if (selection.voiceFilter === "premium") {
      return voice.isPremium;
    }
    if (selection.voiceFilter === "basic") {
      return !voice.isPremium;
    }
    return true;
  });
}

export function formatPremiumUsage(used: number, limit = PREMIUM_CHAR_LIMIT): string {
  return `Used ${Math.max(0, used).toLocaleString()} / ${limit.toLocaleString()} chars for premium voices.`;
}

export function getPremiumUsageAfterRead(
  currentUsed: number,
  text: string,
  limit = PREMIUM_CHAR_LIMIT,
): { used: number; limit: number; remaining: number; exceeded: boolean } {
  const used = Math.max(0, currentUsed) + text.trim().length;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    exceeded: used > limit,
  };
}

export function shouldCountPremiumUsage(
  isPremiumVoice: boolean,
  mode: TtsReaderPluginSettings["preferredMode"],
  credentialKind: CredentialKind | CloudCredentialKind = "none",
): boolean {
  return isPremiumVoice && (mode === "uapi-export" || credentialKind === "cloud-bearer" || credentialKind === "firebase-refresh");
}

export function resolveServerCustomTextMode(
  mode: TtsReaderPluginSettings["preferredMode"],
  hasApiKey: boolean,
  hasCloudAuth = false,
): TtsReaderPluginSettings["preferredMode"] | "" {
  if (mode === "uapi-export" && hasApiKey) {
    return "uapi-export";
  }
  if (hasCloudAuth) {
    return "cloud-playback";
  }
  if (hasApiKey) {
    return "uapi-export";
  }

  return "";
}

export function normalizeCredential(value: string): string {
  return value.trim();
}

export function normalizeUapiKey(value: string): string {
  return normalizeCredential(value).replace(/^Bearer\s+/i, "").replace(/^UAPI-/i, "");
}

export function normalizeBearerToken(value: string): string {
  return normalizeCredential(value).replace(/^Bearer\s+/i, "");
}

export function getCredentialKind(value: string): CredentialKind {
  const credential = normalizeCredential(value);
  if (!credential) {
    return "none";
  }
  if (normalizeBearerToken(credential).startsWith("UAPI-")) {
    return "uapi-key";
  }
  return "cloud-bearer";
}

export function getCredentialParts(
  value: string,
  firebaseApiKey = "",
  firebaseRefreshToken = "",
): CredentialParts {
  const normalizedFirebaseApiKey = normalizeCredential(firebaseApiKey);
  const normalizedFirebaseRefreshToken = normalizeCredential(firebaseRefreshToken);
  const hasFirebaseRefresh = Boolean(normalizedFirebaseApiKey && normalizedFirebaseRefreshToken);
  const kind = getCredentialKind(value);
  const cloudCredentialKind: CloudCredentialKind = hasFirebaseRefresh
    ? "firebase-refresh"
    : kind === "cloud-bearer"
      ? "cloud-bearer"
      : "none";
  const shared = {
    cloudCredentialKind,
    hasCloudAuth: cloudCredentialKind !== "none",
    ...(hasFirebaseRefresh
      ? {
          firebaseApiKey: normalizedFirebaseApiKey,
          firebaseRefreshToken: normalizedFirebaseRefreshToken,
        }
      : {}),
  };
  if (kind === "uapi-key") {
    return { kind, apiKey: normalizeUapiKey(value), ...shared };
  }
  if (kind === "cloud-bearer") {
    return { kind, cloudBearerToken: normalizeBearerToken(value), ...shared };
  }
  if (hasFirebaseRefresh) {
    return { kind: "firebase-refresh", ...shared };
  }
  return { kind, ...shared };
}

export function fingerprintCredential(value: string): string {
  const credential = normalizeCredential(value);
  if (!credential) {
    return "";
  }

  let hash = 2166136261;
  for (let index = 0; index < credential.length; index += 1) {
    hash ^= credential.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function buildAudioCacheKey(parts: AudioCacheKeyParts): string {
  return JSON.stringify({
    text: parts.text.trim(),
    voiceId: parts.voiceId,
    lang: parts.lang,
    rate: parts.rate,
    mode: parts.mode,
    isTest: parts.isTest,
    credentialKind: parts.credentialKind,
    credentialFingerprint: parts.credentialFingerprint,
  });
}

export function putBoundedCacheEntry<K, V>(cache: Map<K, V>, key: K, value: V, limit = AUDIO_CACHE_LIMIT): void {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);

  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value as K | undefined;
    if (oldestKey === undefined) {
      return;
    }
    cache.delete(oldestKey);
  }
}

export function getBoundedCacheEntry<K, V>(cache: Map<K, V>, key: K): V | undefined {
  if (!cache.has(key)) {
    return undefined;
  }

  const value = cache.get(key);
  if (value !== undefined) {
    cache.delete(key);
    cache.set(key, value);
  }
  return value;
}

export function getVoiceDemoUrl(voice: TtsReaderVoice): string {
  if (!voice.demo) {
    return "";
  }

  return new URL(voice.demo, "https://ttsreader.com/").href;
}

function getLanguageCode(locale: string): string {
  return normalizeLocale(locale).split("-")[0] ?? "";
}

function normalizeLocale(locale: string): string {
  const [language = "", region = ""] = locale.replace("_", "-").split("-");
  return region ? `${language.toLowerCase()}-${region.toUpperCase()}` : language.toLowerCase();
}

function displayLanguage(languageCode: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(languageCode) ?? languageCode;
  } catch {
    return languageCode;
  }
}

function displayRegion(locale: string): string {
  const region = locale.split("-")[1];
  if (!region) {
    return displayLanguage(getLanguageCode(locale));
  }

  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(region) ?? region;
  } catch {
    return region;
  }
}

function localeFlag(locale: string): string {
  const region = locale.split("-")[1];
  if (!region || region.length !== 2) {
    return "";
  }

  return [...region.toUpperCase()]
    .map((char) => String.fromCodePoint(0x1f1e6 + char.charCodeAt(0) - 65))
    .join("");
}

function compareLanguageGroups(left: VoiceLanguageGroup, right: VoiceLanguageGroup): number {
  if (left.languageCode === "en") {
    return -1;
  }
  if (right.languageCode === "en") {
    return 1;
  }
  return left.name.localeCompare(right.name);
}

function compareAccents(left: VoiceAccentGroup, right: VoiceAccentGroup): number {
  const priority: Record<string, number> = {
    "en-US": 0,
    "en-GB": 1,
    "es-ES": 0,
    "es-MX": 1,
    "pt-BR": 0,
    "pt-PT": 1,
  };

  return (priority[left.code] ?? 100) - (priority[right.code] ?? 100) || left.name.localeCompare(right.name);
}
