import { TTSREADER_SERVER_VOICES } from "./ttsreader-voices.generated.js";

export type TtsReaderVoiceSource = "browser" | "ttsreader-server" | "boson";

export interface TtsReaderVoice {
  id: string;
  name: string;
  lang: string;
  source: TtsReaderVoiceSource;
  isPremium: boolean;
  localService?: boolean;
  gender?: "f" | "m" | string;
  premiumLevel?: number;
  demo?: string;
}

export interface TtsReaderAudio {
  bytes: Uint8Array;
  contentType: string;
}

export interface TtsReaderClientOptions {
  apiKey?: string;
  cloudBearerToken?: string;
  bosonApiKey?: string;
  fetch?: typeof fetch;
  cloudPlaybackEndpoint?: string;
  uapiEndpoint?: string;
  bosonEndpoint?: string;
}

export interface FirebaseTokenRefreshOptions {
  apiKey: string;
  refreshToken: string;
  fetch?: typeof fetch;
  endpoint?: string;
}

export interface FirebaseTokenRefreshResult {
  idToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface SynthesizeOptions {
  text: string;
  voiceId: string;
  lang: string;
  rate?: number;
  mode?: "cloud-playback" | "uapi-export";
  quality?: "24khz" | "48khz_192kbps";
  isTest?: boolean;
}

const DEFAULT_CLOUD_PLAYBACK_ENDPOINT = "https://us-central1-ttsreader.cloudfunctions.net/tts";
const DEFAULT_UAPI_ENDPOINT = "https://ttsreader.com/api/ttsSync";
const DEFAULT_BOSON_SPEECH_ENDPOINT = "https://api.boson.ai/v1/audio/speech";
const DEFAULT_FIREBASE_REFRESH_ENDPOINT = "https://securetoken.googleapis.com/v1/token";

const BOSON_VOICES = [
  { id: "chloe", name: "Chloe", gender: "f" },
  { id: "eleanor", name: "Eleanor", gender: "f" },
  { id: "jake", name: "Jake", gender: "m" },
  { id: "marcus", name: "Marcus", gender: "m" },
  { id: "nora", name: "Nora", gender: "f" },
  { id: "oliver", name: "Oliver", gender: "m" },
] as const;

export function getBundledServerVoices(): TtsReaderVoice[] {
  return TTSREADER_SERVER_VOICES.map((voice) => ({
    id: voice.voiceURI,
    name: voice.name,
    lang: voice.lang,
    source: "ttsreader-server",
    isPremium: voice.premiumLevel > 0,
    premiumLevel: voice.premiumLevel,
    gender: voice.gender,
    demo: "demo" in voice ? voice.demo : undefined,
  }));
}

export function getBosonVoices(): TtsReaderVoice[] {
  return BOSON_VOICES.map((voice) => ({
    id: voice.id,
    name: voice.name,
    lang: "en-US",
    source: "boson",
    isPremium: false,
    gender: voice.gender,
  }));
}

export function getBrowserVoices(voices?: SpeechSynthesisVoice[]): TtsReaderVoice[] {
  const source = voices ?? globalThis.speechSynthesis?.getVoices?.() ?? [];
  return source.map((voice) => ({
    id: voice.voiceURI,
    name: voice.name,
    lang: voice.lang,
    source: "browser",
    isPremium: false,
    localService: voice.localService,
  }));
}

export function isServerVoice(voiceId: string): boolean {
  return voiceId.startsWith("ttsreaderServer.") || voiceId.startsWith("azure.");
}

export function normalizeRate(rate: number | undefined): number {
  const parsed = typeof rate === "number" && Number.isFinite(rate) ? rate : 1;
  return Math.min(4, Math.max(0.1, parsed));
}

function normalizeCloudRate(rate: number | undefined): number {
  const normalized = normalizeRate(rate);
  return normalized >= 0.95 ? 1 : normalized;
}

function normalizeApiKey(apiKey: string): string {
  return apiKey.startsWith("UAPI-") ? apiKey : `UAPI-${apiKey}`;
}

function normalizeBearerToken(token: string): string {
  return token.trim().replace(/^Bearer\s+/i, "");
}

export class TtsReaderClient {
  private readonly apiKey?: string;
  private readonly cloudBearerToken: string;
  private readonly bosonApiKey: string;
  private readonly fetcher: typeof fetch;
  private readonly cloudPlaybackEndpoint: string;
  private readonly uapiEndpoint: string;
  private readonly bosonEndpoint: string;

  constructor(options: TtsReaderClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.cloudBearerToken = normalizeBearerToken(options.cloudBearerToken ?? "");
    this.bosonApiKey = normalizeBearerToken(options.bosonApiKey ?? "");
    this.fetcher = options.fetch ?? fetch.bind(globalThis);
    this.cloudPlaybackEndpoint = options.cloudPlaybackEndpoint ?? DEFAULT_CLOUD_PLAYBACK_ENDPOINT;
    this.uapiEndpoint = options.uapiEndpoint ?? DEFAULT_UAPI_ENDPOINT;
    this.bosonEndpoint = options.bosonEndpoint ?? DEFAULT_BOSON_SPEECH_ENDPOINT;
  }

  listVoices(browserVoices?: SpeechSynthesisVoice[]): TtsReaderVoice[] {
    return [...getBrowserVoices(browserVoices), ...getBundledServerVoices(), ...getBosonVoices()];
  }

  async synthesize(options: SynthesizeOptions): Promise<TtsReaderAudio> {
    if (!options.text.trim()) {
      throw new Error("Cannot synthesize empty text.");
    }

    if (options.mode === "uapi-export") {
      return this.synthesizeWithUapi(options);
    }

    return this.synthesizeWithCloudPlayback(options);
  }

  private async synthesizeWithCloudPlayback(options: SynthesizeOptions): Promise<TtsReaderAudio> {
    const response = await this.fetcher(this.cloudPlaybackEndpoint, {
      method: "POST",
      headers: {
        ...(this.cloudBearerToken ? { Authorization: `Bearer ${this.cloudBearerToken}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: options.text,
        lang: options.lang,
        voice: options.voiceId,
        rate: normalizeCloudRate(options.rate),
        isTest: options.isTest ?? false,
      }),
    });

    return readAudioResponse(response, "TTSReader cloud playback request failed");
  }

  private async synthesizeWithUapi(options: SynthesizeOptions): Promise<TtsReaderAudio> {
    if (!this.apiKey) {
      throw new Error("TTSReader UAPI export mode requires an apiKey.");
    }

    const response = await this.fetcher(this.uapiEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${normalizeApiKey(this.apiKey)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: options.text,
        lang: options.lang,
        voice: options.voiceId,
        rate: normalizeRate(options.rate),
        ...(options.quality ? { quality: options.quality } : {}),
      }),
    });

    return readAudioResponse(response, "TTSReader UAPI export request failed");
  }

  async synthesizeWithBoson(options: Pick<SynthesizeOptions, "text" | "voiceId" | "rate">): Promise<TtsReaderAudio> {
    if (!options.text.trim()) {
      throw new Error("Cannot synthesize empty text.");
    }
    if (!this.bosonApiKey) {
      throw new Error("Boson Higgs Audio TTS requires a Boson API key.");
    }

    const response = await this.fetcher(this.bosonEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.bosonApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "higgs-audio-v3-tts",
        input: options.text,
        voice: options.voiceId,
        response_format: "mp3",
        stream: false,
      }),
    });

    return readAudioResponse(response, "Boson Higgs Audio TTS request failed");
  }
}

export async function refreshFirebaseIdToken(
  options: FirebaseTokenRefreshOptions,
): Promise<FirebaseTokenRefreshResult> {
  const apiKey = options.apiKey.trim();
  const refreshToken = options.refreshToken.trim();
  if (!apiKey || !refreshToken) {
    throw new Error("Firebase token refresh requires both apiKey and refreshToken.");
  }

  const fetcher = options.fetch ?? fetch.bind(globalThis);
  const endpoint = options.endpoint ?? DEFAULT_FIREBASE_REFRESH_ENDPOINT;
  const response = await fetcher(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const firebaseMessage = parseFirebaseErrorMessage(body);
    throw new Error(
      `Firebase token refresh failed: ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${
        firebaseMessage ? ` - ${firebaseMessage}` : body ? ` - ${body}` : ""
      }`,
    );
  }

  const body = await response.json() as Partial<{
    id_token: string;
    refresh_token: string;
    expires_in: string | number;
  }>;
  if (!body.id_token) {
    throw new Error("Firebase token refresh did not return an id_token.");
  }

  return {
    idToken: body.id_token,
    refreshToken: body.refresh_token ?? refreshToken,
    expiresIn: Number(body.expires_in) || 3600,
  };
}

function parseFirebaseErrorMessage(body: string): string {
  if (!body.trim()) {
    return "";
  }

  try {
    const parsed = JSON.parse(body) as Partial<{
      error: Partial<{
        message: string;
        status: string;
      }>;
    }>;
    return parsed.error?.message ?? parsed.error?.status ?? "";
  } catch {
    return body.replace(/\s+/g, " ").trim();
  }
}

async function readAudioResponse(response: Response, message: string): Promise<TtsReaderAudio> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${message}: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    bytes,
    contentType: response.headers.get("content-type") ?? "audio/mpeg",
  };
}
