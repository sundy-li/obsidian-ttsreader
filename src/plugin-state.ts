import type { TtsReaderVoice } from "./sdk.js";

export type VoiceFilter = "all" | "premium" | "basic";

export interface TtsReaderPluginSettings {
  apiKey: string;
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
  preferredVoiceId: "",
  preferredMode: "cloud-playback",
  defaultRate: 1,
  preferredLanguageCode: "en",
  preferredAccentCode: "en-US",
  voiceFilter: "all",
  premiumCharsUsed: 0,
};

export const PREMIUM_CHAR_LIMIT = 5000;

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

export function mergeSettings(settings: Partial<TtsReaderPluginSettings> | null | undefined): TtsReaderPluginSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(settings ?? {}),
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

export function shouldCountPremiumUsage(isPremiumVoice: boolean, mode: TtsReaderPluginSettings["preferredMode"]): boolean {
  return isPremiumVoice && mode === "uapi-export";
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
