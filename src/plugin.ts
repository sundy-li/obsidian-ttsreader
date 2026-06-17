import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, requestUrl } from "obsidian";

import { TtsReaderClient, type TtsReaderVoice, isServerVoice, refreshFirebaseIdToken } from "./sdk.js";
import { makeObsidianFetch } from "./obsidian-fetch.js";
import {
  DEFAULT_SETTINGS,
  type VoiceFilter,
  type TtsProvider,
  type TtsReaderPluginSettings,
  AUDIO_CACHE_LIMIT,
  buildAudioCacheKey,
  chooseInitialVoiceId,
  filterVoicesForProvider,
  filterVoicesForSelection,
  fingerprintCredential,
  getBoundedCacheEntry,
  getCredentialParts,
  getReadableText,
  getVoiceDemoUrl,
  groupVoicesByLanguage,
  mergeSettings,
  normalizeCredential,
  putBoundedCacheEntry,
  resolveServerCustomTextMode,
  type VoiceLanguageGroup,
} from "./plugin-state.js";

const TTSREADER_SIGN_IN_URL = "https://ttsreader.com/player/";
const FIREBASE_CREDENTIALS_GUIDE_URL = "https://github.com/sundy-li/obsidian-ttsreader/blob/main/docs/firebase-credentials.md";
const ESTIMATED_SPEECH_CHARS_PER_SECOND = 13;

function showCredentialRowsForProvider(
  provider: TtsProvider,
  rows: { ttsreader: HTMLElement[]; boson: HTMLElement[] },
): void {
  const showTtsReaderRows = provider === "ttsreader";
  for (const row of rows.ttsreader) {
    row.style.display = showTtsReaderRows ? "" : "none";
  }
  for (const row of rows.boson) {
    row.style.display = showTtsReaderRows ? "none" : "";
  }
}

export default class TtsReaderPlugin extends Plugin {
  settings: TtsReaderPluginSettings = DEFAULT_SETTINGS;
  private currentAudio: HTMLAudioElement | null = null;
  private currentObjectUrl: string | null = null;
  private readonly audioCache = new Map<string, { bytes: Uint8Array; contentType: string }>();
  private statusBarEl!: HTMLElement;
  private statusLabelEl!: HTMLElement;
  private statusTimeEl!: HTMLElement;
  private statusTimer: number | null = null;
  private lastPlaybackError = "";
  private browserSpeechStartedAt = 0;
  private browserSpeechEstimatedDuration = 0;

  async onload(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());

    this.addRibbonIcon("volume-2", "TTSReader", () => {
      this.openReader();
    });
    this.createPlaybackStatusBar();

    this.addCommand({
      id: "open-ttsreader",
      name: "Open TTSReader",
      callback: () => this.openReader(),
    });

    this.addCommand({
      id: "speak-selection-or-note",
      name: "Speak selection or current note",
      editorCallback: (editor) => {
        const text = getReadableText(editor.getValue(), editor.getSelection());
        this.openReader(text);
      },
    });

    this.addCommand({
      id: "read-selected-text",
      name: "Read the selected text",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "R" }],
      editorCallback: (editor) => {
        this.readSelectedText(editor.getSelection());
      },
    });

    this.addCommand({
      id: "stop-ttsreader",
      name: "Stop TTSReader playback",
      callback: () => this.stopPlayback(),
    });

    this.addCommand({
      id: "open-ttsreader-sign-in",
      name: "Open TTSReader sign-in page",
      callback: () => this.openTtsReaderSignIn(),
    });

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        const selectedText = editor.getSelection();
        menu.addItem((item) => {
          item
            .setTitle("Read the selected text")
            .setIcon("volume-2")
            .setDisabled(!selectedText.trim())
            .onClick(() => this.readSelectedText(selectedText));
        });
      }),
    );

    this.addSettingTab(new TtsReaderSettingTab(this.app, this));
  }

  onunload(): void {
    this.stopPlayback();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  openReader(initialText = ""): void {
    new TtsReaderModal(this.app, this, initialText).open();
  }

  openTtsReaderSignIn(): void {
    window.open(TTSREADER_SIGN_IN_URL, "_blank", "noopener");
    new Notice("TTSReader sign-in opened. Browser cookies are not shared with Obsidian.");
  }

  async readSelectedText(selectedText: string): Promise<void> {
    const text = selectedText.trim();
    if (!text) {
      new Notice("TTSReader: select text to read first.");
      return;
    }

    const voices = await waitForVoices();
    const voice = this.chooseConfiguredVoice(voices);
    if (!voice) {
      new Notice("TTSReader: no voice is available.");
      return;
    }

    await this.speak(text, voice.id, this.settings.defaultRate, this.settings.preferredMode, this.settings.ttsProvider);
  }

  async playVoiceSample(voice: TtsReaderVoice, rate: number, mode: TtsReaderPluginSettings["preferredMode"], provider = this.settings.ttsProvider): Promise<void> {
    if (provider === "boson") {
      await this.speakWithBosonVoice(`Hello, this is ${voice.name}.`, voice, rate, true);
      return;
    }

    const demoUrl = getVoiceDemoUrl(voice);
    if (demoUrl) {
      await this.playRemoteAudio(demoUrl);
      return;
    }

    const sampleText = `Hello, this is ${voice.name}.`;
    if (!isServerVoice(voice.id)) {
      this.stopPlayback();
      this.speakWithBrowserVoice(sampleText, voice.id, rate);
      return;
    }

    await this.speakWithServerVoice(sampleText, voice, rate, "cloud-playback", true);
  }

  async speak(
    text: string,
    voiceId: string,
    rate: number,
    mode: TtsReaderPluginSettings["preferredMode"],
    provider = this.settings.ttsProvider,
  ): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
      new Notice("TTSReader: no text to read.");
      return;
    }

    this.stopPlayback();

    if (provider === "boson") {
      const voice = getAllVoices().find((candidate) => candidate.source === "boson" && candidate.id === voiceId);
      if (!voice) {
        const message = `Boson voice not found: ${voiceId}`;
        this.showPlaybackError(message);
        throw new Error(message);
      }
      await this.speakWithBosonVoice(trimmed, voice, rate, false);
      return;
    }

    if (!isServerVoice(voiceId)) {
      this.speakWithBrowserVoice(trimmed, voiceId, rate);
      return;
    }

    const voice = getServerAndBrowserVoices().find((candidate) => candidate.id === voiceId);
    if (!voice) {
      const message = `TTSReader voice not found: ${voiceId}`;
      this.showPlaybackError(message);
      throw new Error(message);
    }

    const credential = this.getCredentialParts();
    const serverMode = resolveServerCustomTextMode(
      mode,
      Boolean(credential.apiKey),
      credential.hasCloudAuth,
    );
    if (!serverMode) {
      const message = "Selected TTSReader voices can preview samples, but custom text requires a UAPI key, Cloud Bearer token, or Firebase refresh token. Add authorization in settings or choose a browser voice.";
      this.showPlaybackError(message);
      throw new Error(message);
    }

    await this.speakWithServerVoice(trimmed, voice, rate, serverMode, false);
  }

  private async speakWithServerVoice(
    text: string,
    voice: TtsReaderVoice,
    rate: number,
    mode: TtsReaderPluginSettings["preferredMode"],
    isTest: boolean,
  ): Promise<void> {
    this.stopPlayback();
    const credential = this.getCredentialParts();
    const fetcher = makeObsidianFetch(requestUrl);
    const options = {
      text,
      voiceId: voice.id,
      lang: voice.lang,
      rate,
      mode: mode === "uapi-export" ? "uapi-export" : "cloud-playback",
      isTest,
      quality: "48khz_192kbps",
    } as const;
    const cacheKey = buildAudioCacheKey({
      provider: "ttsreader",
      text,
      voiceId: voice.id,
      lang: voice.lang,
      rate,
      mode: options.mode,
      isTest,
      credentialKind: options.mode === "uapi-export" ? credential.kind : credential.cloudCredentialKind,
      credentialFingerprint: this.getCredentialFingerprint(credential, options.mode),
    });
    const cachedAudio = getBoundedCacheEntry(this.audioCache, cacheKey);
    let audio = cachedAudio;
    if (!audio) {
      try {
        const cloudBearerToken = options.mode === "cloud-playback"
          ? await this.getCloudBearerToken(credential, false, fetcher)
          : "";
        const client = new TtsReaderClient({
          apiKey: credential.apiKey,
          cloudBearerToken,
          fetch: fetcher,
        });
        audio = await client.synthesize(options);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (options.mode === "cloud-playback" && credential.cloudCredentialKind === "firebase-refresh" && isAuthorizationError(message)) {
          try {
            const cloudBearerToken = await this.getCloudBearerToken(credential, true, fetcher);
            const client = new TtsReaderClient({
              apiKey: credential.apiKey,
              cloudBearerToken,
              fetch: fetcher,
            });
            audio = await client.synthesize(options);
          } catch (retryError) {
            const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
            this.showPlaybackError(retryMessage);
            throw retryError;
          }
        } else {
          this.showPlaybackError(message);
          throw error;
        }
      }
      putBoundedCacheEntry(this.audioCache, cacheKey, audio, AUDIO_CACHE_LIMIT);
    }

    await this.playAudioBytes(audio.bytes, audio.contentType);
  }

  private async speakWithBosonVoice(text: string, voice: TtsReaderVoice, rate: number, isTest: boolean): Promise<void> {
    this.stopPlayback();
    const cacheKey = buildAudioCacheKey({
      provider: "boson",
      text,
      voiceId: voice.id,
      lang: voice.lang,
      rate,
      mode: "cloud-playback",
      isTest,
      credentialKind: this.settings.bosonApiKey ? "cloud-bearer" : "none",
      credentialFingerprint: fingerprintCredential(this.settings.bosonApiKey),
    });
    const cachedAudio = getBoundedCacheEntry(this.audioCache, cacheKey);
    let audio = cachedAudio;
    if (!audio) {
      try {
        const client = new TtsReaderClient({
          bosonApiKey: this.settings.bosonApiKey,
          fetch: makeObsidianFetch(requestUrl),
        });
        audio = await client.synthesizeWithBoson({
          text,
          voiceId: voice.id,
          rate,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.showPlaybackError(message);
        throw error;
      }
      putBoundedCacheEntry(this.audioCache, cacheKey, audio, AUDIO_CACHE_LIMIT);
    }

    await this.playAudioBytes(audio.bytes, audio.contentType);
  }

  stopPlayback(): void {
    speechSynthesis.cancel();
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }
    this.finishPlaybackStatus("Stopped");
  }

  private speakWithBrowserVoice(text: string, voiceId: string, rate: number): void {
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = speechSynthesis.getVoices().find((candidate) => candidate.voiceURI === voiceId);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.rate = Math.min(2, Math.max(0.5, rate));
    utterance.onstart = () => this.startBrowserSpeechStatus(text, utterance.rate);
    utterance.onboundary = (event) => this.updateBrowserSpeechStatus(text, event.charIndex);
    utterance.onend = () => this.finishPlaybackStatus("Done");
    utterance.onerror = () => this.finishPlaybackStatus("Stopped");
    speechSynthesis.speak(utterance);
  }

  private createPlaybackStatusBar(): void {
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("ttsreader-plugin-statusbar");
    this.statusBarEl.addClass("ttsreader-plugin-statusbar-idle");
    this.statusBarEl.setAttribute("aria-label", "TTSReader playback status");
    this.statusBarEl.addEventListener("click", () => {
      if (this.lastPlaybackError) {
        new TtsReaderErrorModal(this.app, this.lastPlaybackError).open();
      }
    });

    this.statusBarEl.createSpan({ cls: "ttsreader-plugin-statusbar-icon", text: "♫" });
    this.statusLabelEl = this.statusBarEl.createSpan({ cls: "ttsreader-plugin-statusbar-label", text: "TTSReader" });
    this.statusTimeEl = this.statusBarEl.createSpan({ cls: "ttsreader-plugin-statusbar-time", text: "--:--" });
  }

  private bindAudioStatus(audio: HTMLAudioElement): void {
    audio.addEventListener("loadedmetadata", () => this.updateAudioStatus(audio));
    audio.addEventListener("timeupdate", () => this.updateAudioStatus(audio));
    audio.addEventListener("ended", () => this.finishPlaybackStatus("Done"));
    audio.addEventListener("pause", () => {
      if (!audio.ended) {
        this.updatePlaybackStatus("Paused", audio.currentTime, getFiniteDuration(audio.duration));
      }
    });
    audio.addEventListener("play", () => this.startAudioStatus(audio));
  }

  private startAudioStatus(audio: HTMLAudioElement): void {
    this.updatePlaybackStatus("Playing", audio.currentTime, getFiniteDuration(audio.duration));
  }

  private updateAudioStatus(audio: HTMLAudioElement): void {
    this.updatePlaybackStatus("Playing", audio.currentTime, getFiniteDuration(audio.duration));
  }

  private startBrowserSpeechStatus(text: string, rate: number): void {
    this.browserSpeechStartedAt = Date.now();
    this.browserSpeechEstimatedDuration = Math.max(1, text.length / (ESTIMATED_SPEECH_CHARS_PER_SECOND * rate));
    this.updatePlaybackStatus("Speaking", 0, this.browserSpeechEstimatedDuration);
    this.restartBrowserStatusTimer();
  }

  private updateBrowserSpeechStatus(text: string, charIndex: number): void {
    const progress = Math.max(0, Math.min(1, charIndex / Math.max(1, text.length)));
    this.updatePlaybackStatus("Speaking", progress * this.browserSpeechEstimatedDuration, this.browserSpeechEstimatedDuration);
  }

  private restartBrowserStatusTimer(): void {
    if (this.statusTimer !== null) {
      window.clearInterval(this.statusTimer);
    }
    this.statusTimer = window.setInterval(() => {
      const elapsed = (Date.now() - this.browserSpeechStartedAt) / 1000;
      this.updatePlaybackStatus("Speaking", elapsed, this.browserSpeechEstimatedDuration);
      if (elapsed >= this.browserSpeechEstimatedDuration) {
        this.finishPlaybackStatus("Done");
      }
    }, 500);
  }

  private updatePlaybackStatus(label: string, currentSeconds: number, totalSeconds: number): void {
    const duration = getFiniteDuration(totalSeconds);
    const current = Math.max(0, Math.min(currentSeconds, duration || currentSeconds));

    this.statusBarEl.removeClass("ttsreader-plugin-statusbar-idle");
    this.statusBarEl.removeClass("ttsreader-plugin-statusbar-error");
    this.statusBarEl.addClass("ttsreader-plugin-statusbar-active");
    this.statusBarEl.setAttribute("aria-label", `TTSReader playback status: ${label}`);
    this.statusBarEl.removeAttribute("title");
    this.statusLabelEl.setText(label);
    this.statusTimeEl.setText(duration > 0 ? `${formatTime(current)} / ${formatTime(duration)}` : formatTime(current));
  }

  private finishPlaybackStatus(label: string, detail = ""): void {
    if (this.statusTimer !== null) {
      window.clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
    if (!this.statusBarEl) {
      return;
    }
    this.statusBarEl.removeClass("ttsreader-plugin-statusbar-active");
    this.statusBarEl.addClass("ttsreader-plugin-statusbar-idle");
    this.statusBarEl.toggleClass("ttsreader-plugin-statusbar-error", label === "Error");
    this.statusLabelEl.setText(label);
    this.statusTimeEl.setText(detail ? shortenStatusDetail(detail) : "--:--");
    this.statusBarEl.setAttribute("aria-label", detail ? `TTSReader playback status: ${label}. ${detail}` : `TTSReader playback status: ${label}`);
    if (detail) {
      this.statusBarEl.setAttribute("title", detail);
    } else {
      this.statusBarEl.removeAttribute("title");
    }
  }

  private chooseConfiguredVoice(voices: TtsReaderVoice[]): TtsReaderVoice | undefined {
    const providerVoices = filterVoicesForProvider(voices, this.settings.ttsProvider);
    const filtered = filterVoicesForSelection(providerVoices, {
      languageCode: this.settings.preferredLanguageCode,
      accentCode: this.settings.preferredAccentCode,
      voiceFilter: this.settings.voiceFilter,
    });
    return (
      filtered.find((voice) => voice.id === this.settings.preferredVoiceId) ??
      providerVoices.find((voice) => voice.id === this.settings.preferredVoiceId) ??
      filtered[0] ??
      providerVoices[0]
    );
  }

  private async playRemoteAudio(url: string): Promise<void> {
    this.stopPlayback();
    const cacheKey = `remote:${url}`;
    const cachedAudio = getBoundedCacheEntry(this.audioCache, cacheKey);
    if (cachedAudio) {
      await this.playAudioBytes(cachedAudio.bytes, cachedAudio.contentType);
      return;
    }

    const response = await makeObsidianFetch(requestUrl)(url);
    if (!response.ok) {
      this.showPlaybackError(`Voice sample request failed: ${response.status} ${response.statusText}`);
      throw new Error(`Voice sample request failed: ${response.status} ${response.statusText}`);
    }
    const audio = {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "audio/mpeg",
    };
    putBoundedCacheEntry(this.audioCache, cacheKey, audio, AUDIO_CACHE_LIMIT);
    await this.playAudioBytes(audio.bytes, audio.contentType);
  }

  private async playAudioBytes(bytes: Uint8Array, contentType: string): Promise<void> {
    const audioBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([audioBuffer], { type: contentType });
    this.currentObjectUrl = URL.createObjectURL(blob);
    this.currentAudio = new Audio(this.currentObjectUrl);
    this.bindAudioStatus(this.currentAudio);
    await this.currentAudio.play();
    this.startAudioStatus(this.currentAudio);
  }

  showPlaybackError(message: string): void {
    this.lastPlaybackError = message;
    console.error("TTSReader playback error:", message);
    new Notice(`TTSReader: ${message}`, 12000);
    this.finishPlaybackStatus("Error", message);
  }

  private getCredentialParts() {
    return getCredentialParts(
      this.settings.credential,
      this.settings.firebaseApiKey,
      this.settings.firebaseRefreshToken,
    );
  }

  private async getCloudBearerToken(
    credential: ReturnType<typeof getCredentialParts>,
    forceRefresh: boolean,
    fetcher: typeof fetch,
  ): Promise<string> {
    if (credential.cloudCredentialKind !== "firebase-refresh") {
      return credential.cloudBearerToken ?? "";
    }

    validateFirebaseRefreshCredentials(credential.firebaseApiKey ?? "", credential.firebaseRefreshToken ?? "");

    const now = Date.now();
    if (!forceRefresh && this.settings.firebaseAccessToken && this.settings.firebaseAccessTokenExpiresAt - now > 60_000) {
      return this.settings.firebaseAccessToken;
    }

    const refreshed = await refreshFirebaseIdToken({
      apiKey: credential.firebaseApiKey ?? "",
      refreshToken: credential.firebaseRefreshToken ?? "",
      fetch: fetcher,
    });
    this.settings.firebaseAccessToken = refreshed.idToken;
    this.settings.firebaseRefreshToken = refreshed.refreshToken;
    this.settings.firebaseAccessTokenExpiresAt = now + refreshed.expiresIn * 1000;
    await this.saveSettings();
    return refreshed.idToken;
  }

  private getCredentialFingerprint(
    credential: ReturnType<typeof getCredentialParts>,
    mode: "cloud-playback" | "uapi-export",
  ): string {
    if (mode === "cloud-playback" && credential.cloudCredentialKind === "firebase-refresh") {
      return fingerprintCredential(`${credential.firebaseApiKey ?? ""}:${credential.firebaseRefreshToken ?? ""}`);
    }
    if (mode === "cloud-playback" && credential.cloudBearerToken) {
      return fingerprintCredential(credential.cloudBearerToken);
    }
    return fingerprintCredential(this.settings.credential);
  }
}

function getFiniteDuration(duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function shortenStatusDetail(detail: string): string {
  const normalized = detail.replace(/\s+/g, " ").trim();
  return normalized.length > 34 ? `${normalized.slice(0, 31)}...` : normalized;
}

function isAuthorizationError(message: string): boolean {
  return /\b(401|403)\b/.test(message) || /auth|token|permission|unauthori[sz]ed|forbidden/i.test(message);
}

function getVoiceSourceLabel(voice: TtsReaderVoice): string {
  if (voice.source === "browser") {
    return "Browser";
  }
  if (voice.source === "boson") {
    return "Boson";
  }
  return "TTSReader";
}

function validateFirebaseRefreshCredentials(apiKey: string, refreshToken: string): void {
  if (!apiKey.startsWith("AIza")) {
    throw new Error("Firebase API key should start with AIza. Copy value.apiKey from the TTSReader Firebase auth record.");
  }
  if (!refreshToken.startsWith("AMf-")) {
    throw new Error("Firebase refresh token should start with AMf-. Copy value.stsTokenManager.refreshToken from the TTSReader Firebase auth record.");
  }
  if (refreshToken.includes("…") || refreshToken.includes("...")) {
    throw new Error("Firebase refresh token is truncated. It contains an ellipsis; expand the value and copy the full string, not the DevTools preview.");
  }
  if (/\s/.test(apiKey) || /\s/.test(refreshToken)) {
    throw new Error("Firebase API key and refresh token must not contain spaces or line breaks.");
  }
}

function addSecretVisibilityButton(inputEl: HTMLInputElement, parentEl: HTMLElement): HTMLButtonElement {
  const button = parentEl.createEl("button", {
    text: "Show",
    cls: "ttsreader-plugin-secret-toggle",
  });
  button.type = "button";
  button.setAttribute("aria-label", "Show secret value");
  button.addEventListener("click", () => {
    const shouldShow = inputEl.type === "password";
    inputEl.type = shouldShow ? "text" : "password";
    button.setText(shouldShow ? "Hide" : "Show");
    button.setAttribute("aria-label", shouldShow ? "Hide secret value" : "Show secret value");
  });
  return button;
}

function toggleSecretInput(inputEl: HTMLInputElement, buttonEl: HTMLButtonElement): void {
  const shouldShow = inputEl.type === "password";
  inputEl.type = shouldShow ? "text" : "password";
  buttonEl.setText(shouldShow ? "Hide" : "Show");
  buttonEl.setAttribute("aria-label", shouldShow ? "Hide secret value" : "Show secret value");
}

class TtsReaderErrorModal extends Modal {
  constructor(app: App, private readonly message: string) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "TTSReader error" });
    contentEl.createEl("pre", {
      cls: "ttsreader-plugin-error-detail",
      text: this.message,
    });
    new Setting(contentEl)
      .addButton((button) => {
        button
          .setButtonText("Copy error")
          .onClick(async () => {
            await navigator.clipboard.writeText(this.message);
            new Notice("TTSReader error copied.");
          });
      })
      .addButton((button) => {
        button
          .setButtonText("Close")
          .onClick(() => this.close());
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class TtsReaderModal extends Modal {
  private readonly plugin: TtsReaderPlugin;
  private readonly initialText: string;
  private textArea!: HTMLTextAreaElement;
  private providerSelect!: HTMLSelectElement;
  private languageSelect!: HTMLSelectElement;
  private accentSelect!: HTMLSelectElement;
  private voiceSelect!: HTMLSelectElement;
  private sampleButton!: HTMLButtonElement;
  private modeSelect!: HTMLSelectElement;
  private rateInput!: HTMLInputElement;
  private statusEl!: HTMLElement;
  private voices: TtsReaderVoice[] = [];
  private languageGroups: VoiceLanguageGroup[] = [];
  private voiceFilter: VoiceFilter = "all";

  constructor(app: App, plugin: TtsReaderPlugin, initialText: string) {
    super(app);
    this.plugin = plugin;
    this.initialText = initialText;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "TTSReader" });

    this.voices = await waitForVoices();
    this.languageGroups = groupVoicesByLanguage(this.voices);
    this.voiceFilter = this.plugin.settings.voiceFilter;

    const wrapper = contentEl.createDiv({ cls: "ttsreader-plugin-control" });
    this.textArea = wrapper.createEl("textarea");
    this.textArea.value = this.initialText;
    this.textArea.placeholder = "Text to speech";

    const providerRow = wrapper.createDiv({ cls: "ttsreader-plugin-row" });
    providerRow.createEl("label", { text: "Platform" });
    this.providerSelect = providerRow.createEl("select");
    this.providerSelect.createEl("option", { value: "boson", text: "Boson Higgs Audio" });
    this.providerSelect.createEl("option", { value: "ttsreader", text: "TTSReader" });
    this.providerSelect.value = this.plugin.settings.ttsProvider;
    let credentialRows: { ttsreader: HTMLElement[]; boson: HTMLElement[] } | null = null;
    this.providerSelect.addEventListener("change", async () => {
      this.plugin.settings.ttsProvider = this.providerSelect.value as TtsProvider;
      this.plugin.settings.voiceFilter = "all";
      this.voiceFilter = "all";
      await this.plugin.saveSettings();
      if (credentialRows) {
        showCredentialRowsForProvider(this.plugin.settings.ttsProvider, credentialRows);
      }
      this.languageGroups = groupVoicesByLanguage(this.getProviderVoices());
      this.populateLanguageSelect();
      this.populateAccentSelect();
      this.populateVoiceSelect();
    });

    const credentialRow = wrapper.createDiv({ cls: "ttsreader-plugin-row" });
    credentialRow.createEl("label", { text: "Authorization / UAPI Key" });
    const credentialInput = credentialRow.createEl("input", { type: "password" });
    credentialInput.placeholder = "UAPI-... or Bearer eyJ...";
    credentialInput.value = this.plugin.settings.credential;
    credentialInput.addEventListener("change", async () => {
      this.plugin.settings.credential = normalizeCredential(credentialInput.value);
      await this.plugin.saveSettings();
    });
    addSecretVisibilityButton(credentialInput, credentialRow);

    const firebaseApiKeyRow = wrapper.createDiv({ cls: "ttsreader-plugin-row" });
    firebaseApiKeyRow.createEl("label", { text: "Firebase API key" });
    const firebaseApiKeyInput = firebaseApiKeyRow.createEl("input", { type: "password" });
    firebaseApiKeyInput.placeholder = "AIza...";
    firebaseApiKeyInput.value = this.plugin.settings.firebaseApiKey;
    firebaseApiKeyInput.addEventListener("change", async () => {
      this.plugin.settings.firebaseApiKey = normalizeCredential(firebaseApiKeyInput.value);
      this.plugin.settings.firebaseAccessToken = "";
      this.plugin.settings.firebaseAccessTokenExpiresAt = 0;
      await this.plugin.saveSettings();
    });
    addSecretVisibilityButton(firebaseApiKeyInput, firebaseApiKeyRow);

    const firebaseRefreshRow = wrapper.createDiv({ cls: "ttsreader-plugin-row" });
    firebaseRefreshRow.createEl("label", { text: "Firebase refresh token" });
    const firebaseRefreshInput = firebaseRefreshRow.createEl("input", { type: "password" });
    firebaseRefreshInput.placeholder = "AMf-vB...";
    firebaseRefreshInput.value = this.plugin.settings.firebaseRefreshToken;
    firebaseRefreshInput.addEventListener("change", async () => {
      this.plugin.settings.firebaseRefreshToken = normalizeCredential(firebaseRefreshInput.value);
      this.plugin.settings.firebaseAccessToken = "";
      this.plugin.settings.firebaseAccessTokenExpiresAt = 0;
      await this.plugin.saveSettings();
    });
    addSecretVisibilityButton(firebaseRefreshInput, firebaseRefreshRow);

    const bosonApiKeyRow = wrapper.createDiv({ cls: "ttsreader-plugin-row" });
    bosonApiKeyRow.createEl("label", { text: "Boson API key" });
    const bosonApiKeyInput = bosonApiKeyRow.createEl("input", { type: "password" });
    bosonApiKeyInput.placeholder = "bai-...";
    bosonApiKeyInput.value = this.plugin.settings.bosonApiKey;
    bosonApiKeyInput.addEventListener("change", async () => {
      this.plugin.settings.bosonApiKey = normalizeCredential(bosonApiKeyInput.value);
      await this.plugin.saveSettings();
    });
    addSecretVisibilityButton(bosonApiKeyInput, bosonApiKeyRow);

    credentialRows = {
      ttsreader: [credentialRow, firebaseApiKeyRow, firebaseRefreshRow],
      boson: [bosonApiKeyRow],
    };
    showCredentialRowsForProvider(this.plugin.settings.ttsProvider, credentialRows);

    const languageRow = wrapper.createDiv({ cls: "ttsreader-plugin-row" });
    languageRow.createEl("label", { text: "Reading Language" });
    this.languageSelect = languageRow.createEl("select");
    this.languageSelect.addEventListener("change", () => {
      this.plugin.settings.preferredLanguageCode = this.languageSelect.value;
      this.plugin.settings.preferredAccentCode = "";
      this.populateAccentSelect();
      this.populateVoiceSelect();
    });

    const accentRow = wrapper.createDiv({ cls: "ttsreader-plugin-row" });
    accentRow.createEl("label", { text: "Region / Accent" });
    this.accentSelect = accentRow.createEl("select");
    this.accentSelect.addEventListener("change", () => {
      this.plugin.settings.preferredAccentCode = this.accentSelect.value;
      this.populateVoiceSelect();
    });

    const modeRow = wrapper.createDiv({ cls: "ttsreader-plugin-row" });
    modeRow.createEl("label", { text: "Mode" });
    this.modeSelect = modeRow.createEl("select");
    this.modeSelect.createEl("option", { value: "cloud-playback", text: "Cloud playback" });
    this.modeSelect.createEl("option", { value: "uapi-export", text: "UAPI export" });
    this.modeSelect.value = this.plugin.settings.preferredMode;

    const rateRow = wrapper.createDiv({ cls: "ttsreader-plugin-row" });
    rateRow.createEl("label", { text: "Playback Speed" });
    this.rateInput = rateRow.createEl("input", { type: "range" });
    this.rateInput.min = "0.5";
    this.rateInput.max = "2";
    this.rateInput.step = "0.05";
    this.rateInput.value = String(this.plugin.settings.defaultRate);
    const rateValue = rateRow.createEl("span", { text: this.rateInput.value });
    this.rateInput.addEventListener("input", () => {
      rateValue.setText(Number(this.rateInput.value).toFixed(2).replace(/0$/, "").replace(/\.0$/, ""));
    });

    const filterRow = wrapper.createDiv({ cls: "ttsreader-plugin-row ttsreader-plugin-filter-row" });
    filterRow.createEl("label", { text: "Voice Selection" });
    const filterButtons = filterRow.createDiv({ cls: "ttsreader-plugin-filter-buttons" });
    for (const filter of ["all", "premium", "basic"] as const) {
      const label = filter === "all" ? "All" : filter === "premium" ? "Premium" : "Basic";
      const button = filterButtons.createEl("button", {
        text: label,
        cls: filter === this.voiceFilter ? "ttsreader-plugin-filter-active" : "",
      });
      button.addEventListener("click", () => {
        this.voiceFilter = filter;
        this.plugin.settings.voiceFilter = filter;
        filterButtons.querySelectorAll("button").forEach((candidate) => {
          candidate.removeClass("ttsreader-plugin-filter-active");
        });
        button.addClass("ttsreader-plugin-filter-active");
        this.populateVoiceSelect();
      });
    }

    const voiceRow = wrapper.createDiv({ cls: "ttsreader-plugin-row ttsreader-plugin-voice-row" });
    this.voiceSelect = voiceRow.createEl("select");
    this.voiceSelect.addEventListener("change", () => {
      this.plugin.settings.preferredVoiceId = this.voiceSelect.value;
    });
    this.sampleButton = voiceRow.createEl("button", {
      text: "Play sample",
      cls: "ttsreader-plugin-sample-button",
    });
    this.sampleButton.addEventListener("click", () => this.playSample());

    const buttonRow = wrapper.createDiv({ cls: "ttsreader-plugin-row" });
    const playButton = buttonRow.createEl("button", { text: "Play" });
    const stopButton = buttonRow.createEl("button", { text: "Stop" });
    playButton.addEventListener("click", () => this.play());
    stopButton.addEventListener("click", () => this.plugin.stopPlayback());

    this.statusEl = wrapper.createDiv({ cls: "ttsreader-plugin-status" });
    this.populateLanguageSelect();
    this.populateAccentSelect();
    this.populateVoiceSelect();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async play(): Promise<void> {
    this.statusEl.setText("Preparing audio...");
    try {
      const voiceId = this.voiceSelect.value;
      const provider = this.providerSelect.value as TtsProvider;
      const mode = this.modeSelect.value as TtsReaderPluginSettings["preferredMode"];
      const rate = Number(this.rateInput.value) || 1;
      this.plugin.settings.preferredVoiceId = voiceId;
      this.plugin.settings.ttsProvider = provider;
      this.plugin.settings.preferredMode = mode;
      this.plugin.settings.defaultRate = rate;
      this.plugin.settings.preferredLanguageCode = this.languageSelect.value;
      this.plugin.settings.preferredAccentCode = this.accentSelect.value;
      this.plugin.settings.voiceFilter = this.voiceFilter;
      await this.plugin.saveSettings();
      await this.plugin.speak(this.textArea.value, voiceId, rate, mode, provider);
      this.statusEl.setText("Playing");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.statusEl.setText(message);
      new Notice(`TTSReader: ${message}`);
    }
  }

  private async playSample(): Promise<void> {
    this.statusEl.setText("Preparing sample...");
    try {
      const voice = this.voices.find((candidate) => candidate.id === this.voiceSelect.value);
      if (!voice) {
        this.statusEl.setText("No voice selected");
        return;
      }
      await this.plugin.playVoiceSample(
        voice,
        Number(this.rateInput.value) || 1,
        this.modeSelect.value as TtsReaderPluginSettings["preferredMode"],
        this.providerSelect.value as TtsProvider,
      );
      this.statusEl.setText("Playing sample");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.statusEl.setText(message);
      new Notice(`TTSReader: ${message}`);
    }
  }

  private chooseLanguageCode(): string {
    const configured = this.plugin.settings.preferredLanguageCode;
    if (configured && this.languageGroups.some((group) => group.languageCode === configured)) {
      return configured;
    }

    return this.languageGroups[0]?.languageCode ?? "";
  }

  private getProviderVoices(): TtsReaderVoice[] {
    return filterVoicesForProvider(this.voices, this.plugin.settings.ttsProvider);
  }

  private populateLanguageSelect(): void {
    this.languageSelect.empty();
    this.languageGroups = groupVoicesByLanguage(this.getProviderVoices());
    for (const group of this.languageGroups) {
      this.languageSelect.createEl("option", {
        value: group.languageCode,
        text: `${group.flag} ${group.name}`.trim(),
      });
    }
    this.languageSelect.value = this.chooseLanguageCode();
  }

  private populateAccentSelect(): void {
    this.accentSelect.empty();
    const group = this.languageGroups.find((candidate) => candidate.languageCode === this.languageSelect.value);
    const accents = group?.accents ?? [];
    for (const accent of accents) {
      this.accentSelect.createEl("option", {
        value: accent.code,
        text: `${accent.flag} ${accent.name}`.trim(),
      });
    }

    const preferred = this.plugin.settings.preferredAccentCode;
    this.accentSelect.value = accents.some((accent) => accent.code === preferred) ? preferred : accents[0]?.code ?? "";
  }

  private populateVoiceSelect(): void {
    this.voiceSelect.empty();
    const providerVoices = this.getProviderVoices();
    const filtered = filterVoicesForSelection(providerVoices, {
      languageCode: this.languageSelect.value,
      accentCode: this.accentSelect.value,
      voiceFilter: this.voiceFilter,
    });
    const selectedVoiceId = chooseInitialVoiceId(filtered, this.plugin.settings.preferredVoiceId);

    for (const voice of filtered) {
      const badge = voice.isPremium ? "Premium" : "Basic";
      const source = getVoiceSourceLabel(voice);
      const label = `${voice.name} (${badge}, ${source})`;
      this.voiceSelect.createEl("option", { value: voice.id, text: label });
    }

    this.voiceSelect.value = selectedVoiceId;
    this.sampleButton.disabled = !selectedVoiceId;
    this.statusEl.setText(`${filtered.length} of ${providerVoices.length} voices shown`);
  }
}

class TtsReaderSettingTab extends PluginSettingTab {
  private readonly plugin: TtsReaderPlugin;
  private voices: TtsReaderVoice[] = [];
  private languageGroups: VoiceLanguageGroup[] = [];

  constructor(app: App, plugin: TtsReaderPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    void this.displayAsync();
  }

  private async displayAsync(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "TTSReader" });

    new Setting(containerEl)
      .setName("Text-to-speech platform")
      .setDesc("Choose which provider and voice list to use.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("boson", "Boson Higgs Audio")
          .addOption("ttsreader", "TTSReader")
          .setValue(this.plugin.settings.ttsProvider)
          .onChange(async (value) => {
            this.plugin.settings.ttsProvider = value as TtsProvider;
            this.plugin.settings.voiceFilter = "all";
            await this.plugin.saveSettings();
            this.display();
          });
      });

    if (this.plugin.settings.ttsProvider === "ttsreader") {
      let credentialInputEl: HTMLInputElement | null = null;
      new Setting(containerEl)
        .setName("Authorization / UAPI Key")
        .setDesc("Paste a UAPI key, or paste a short-lived Authorization Bearer token. Firebase credentials below are preferred for cloud playback because the plugin can refresh them.")
        .addText((text) => {
          text
            .setPlaceholder("UAPI-... or Bearer eyJ...")
            .setValue(this.plugin.settings.credential)
            .onChange(async (value) => {
              this.plugin.settings.credential = normalizeCredential(value);
              await this.plugin.saveSettings();
            });
          text.inputEl.type = "password";
          credentialInputEl = text.inputEl;
        })
        .addButton((button) => {
          if (!credentialInputEl) {
            return;
          }
          const inputEl = credentialInputEl;
          button
            .setButtonText("Show")
            .setTooltip("Show secret value")
            .onClick(() => toggleSecretInput(inputEl, button.buttonEl));
        });

      let firebaseApiKeyInputEl: HTMLInputElement | null = null;
      new Setting(containerEl)
        .setName("Firebase API key")
        .setDesc("Use the apiKey from the TTSReader Firebase auth record.")
        .addText((text) => {
          text
            .setPlaceholder("AIza...")
            .setValue(this.plugin.settings.firebaseApiKey)
            .onChange(async (value) => {
              this.plugin.settings.firebaseApiKey = normalizeCredential(value);
              this.plugin.settings.firebaseAccessToken = "";
              this.plugin.settings.firebaseAccessTokenExpiresAt = 0;
              await this.plugin.saveSettings();
            });
          text.inputEl.type = "password";
          firebaseApiKeyInputEl = text.inputEl;
        })
        .addButton((button) => {
          if (!firebaseApiKeyInputEl) {
            return;
          }
          const inputEl = firebaseApiKeyInputEl;
          button
            .setButtonText("Show")
            .setTooltip("Show secret value")
            .onClick(() => toggleSecretInput(inputEl, button.buttonEl));
        })
        .addButton((button) => {
          button
            .setButtonText("Guide")
            .setTooltip("Open Firebase credential guide")
            .onClick(() => window.open(FIREBASE_CREDENTIALS_GUIDE_URL, "_blank", "noopener"));
        });

      let firebaseRefreshInputEl: HTMLInputElement | null = null;
      new Setting(containerEl)
        .setName("Firebase refresh token")
        .setDesc("Use stsTokenManager.refreshToken from the TTSReader Firebase auth record. Treat it like a password.")
        .addText((text) => {
          text
            .setPlaceholder("AMf-vB...")
            .setValue(this.plugin.settings.firebaseRefreshToken)
            .onChange(async (value) => {
              this.plugin.settings.firebaseRefreshToken = normalizeCredential(value);
              this.plugin.settings.firebaseAccessToken = "";
              this.plugin.settings.firebaseAccessTokenExpiresAt = 0;
              await this.plugin.saveSettings();
            });
          text.inputEl.type = "password";
          firebaseRefreshInputEl = text.inputEl;
        })
        .addButton((button) => {
          if (!firebaseRefreshInputEl) {
            return;
          }
          const inputEl = firebaseRefreshInputEl;
          button
            .setButtonText("Show")
            .setTooltip("Show secret value")
            .onClick(() => toggleSecretInput(inputEl, button.buttonEl));
        })
        .addButton((button) => {
          button
            .setButtonText("Guide")
            .setTooltip("Open Firebase credential guide")
            .onClick(() => window.open(FIREBASE_CREDENTIALS_GUIDE_URL, "_blank", "noopener"));
        });
    }

    if (this.plugin.settings.ttsProvider === "boson") {
      let bosonApiKeyInputEl: HTMLInputElement | null = null;
      new Setting(containerEl)
        .setName("Boson API key")
        .setDesc("Use a Boson API key for Higgs Audio TTS. Keys usually start with bai-.")
        .addText((text) => {
          text
            .setPlaceholder("bai-...")
            .setValue(this.plugin.settings.bosonApiKey)
            .onChange(async (value) => {
              this.plugin.settings.bosonApiKey = normalizeCredential(value);
              await this.plugin.saveSettings();
            });
          text.inputEl.type = "password";
          bosonApiKeyInputEl = text.inputEl;
        })
        .addButton((button) => {
          if (!bosonApiKeyInputEl) {
            return;
          }
          const inputEl = bosonApiKeyInputEl;
          button
            .setButtonText("Show")
            .setTooltip("Show secret value")
            .onClick(() => toggleSecretInput(inputEl, button.buttonEl));
        });
    }

    this.voices = await waitForVoices();
    const providerVoices = filterVoicesForProvider(this.voices, this.plugin.settings.ttsProvider);
    this.languageGroups = groupVoicesByLanguage(providerVoices);
    const languageCode = this.chooseLanguageCode();
    const accentCode = this.chooseAccentCode(languageCode);
    const filteredVoices = filterVoicesForSelection(providerVoices, {
      languageCode,
      accentCode,
      voiceFilter: this.plugin.settings.voiceFilter,
    });
    const selectedVoiceId = chooseInitialVoiceId(filteredVoices, this.plugin.settings.preferredVoiceId);

    new Setting(containerEl)
      .setName("Reading language")
      .addDropdown((dropdown) => {
        for (const group of this.languageGroups) {
          dropdown.addOption(group.languageCode, `${group.flag} ${group.name}`.trim());
        }
        dropdown.setValue(languageCode).onChange(async (value) => {
          this.plugin.settings.preferredLanguageCode = value;
          this.plugin.settings.preferredAccentCode = "";
          await this.plugin.saveSettings();
          this.display();
        });
      });

    const accents = this.languageGroups.find((group) => group.languageCode === languageCode)?.accents ?? [];
    new Setting(containerEl)
      .setName("Region / Accent")
      .addDropdown((dropdown) => {
        for (const accent of accents) {
          dropdown.addOption(accent.code, `${accent.flag} ${accent.name}`.trim());
        }
        dropdown.setValue(accentCode).onChange(async (value) => {
          this.plugin.settings.preferredAccentCode = value;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("Voice selection")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("all", "All")
          .addOption("premium", "Premium")
          .addOption("basic", "Basic")
          .setValue(this.plugin.settings.voiceFilter)
          .onChange(async (value) => {
            this.plugin.settings.voiceFilter = value as VoiceFilter;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    new Setting(containerEl)
      .setName("Reader")
      .setDesc(`${filteredVoices.length} of ${providerVoices.length} voices shown`)
      .addDropdown((dropdown) => {
        for (const voice of filteredVoices) {
          const badge = voice.isPremium ? "Premium" : "Basic";
          const source = getVoiceSourceLabel(voice);
          dropdown.addOption(voice.id, `${voice.name} (${badge}, ${source})`);
        }
        dropdown.setValue(selectedVoiceId).onChange(async (value) => {
          this.plugin.settings.preferredVoiceId = value;
          await this.plugin.saveSettings();
        });
      })
      .addButton((button) => {
        button
          .setButtonText("Play sample")
          .setDisabled(!selectedVoiceId)
          .onClick(async () => {
            const voice = providerVoices.find((candidate) => candidate.id === this.plugin.settings.preferredVoiceId) ??
              providerVoices.find((candidate) => candidate.id === selectedVoiceId);
            if (!voice) {
              new Notice("TTSReader: no voice selected.");
              return;
            }
            try {
              await this.plugin.playVoiceSample(
                voice,
                this.plugin.settings.defaultRate,
                this.plugin.settings.preferredMode,
                this.plugin.settings.ttsProvider,
              );
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              new Notice(`TTSReader: ${message}`);
            }
          });
      });

    new Setting(containerEl)
      .setName("Default server mode")
      .setDesc("Only used by TTSReader voices. Boson always uses Higgs Audio cloud playback.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("cloud-playback", "Cloud playback")
          .addOption("uapi-export", "UAPI export")
          .setValue(this.plugin.settings.preferredMode)
          .onChange(async (value) => {
            this.plugin.settings.preferredMode = value as TtsReaderPluginSettings["preferredMode"];
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Default rate")
      .addSlider((slider) => {
        slider
          .setLimits(0.5, 2, 0.05)
          .setValue(this.plugin.settings.defaultRate)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.defaultRate = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Premium account sign-in")
      .setDesc(
        "Opens the TTSReader player in your browser. Obsidian cannot read Google/Apple login cookies from that browser session; paste Firebase credentials or a UAPI key for authenticated playback.",
      )
      .addButton((button) => {
        button
          .setButtonText("Open TTSReader")
          .onClick(() => this.plugin.openTtsReaderSignIn());
      });
  }

  private chooseLanguageCode(): string {
    const configured = this.plugin.settings.preferredLanguageCode;
    if (configured && this.languageGroups.some((group) => group.languageCode === configured)) {
      return configured;
    }

    return this.languageGroups[0]?.languageCode ?? "";
  }

  private chooseAccentCode(languageCode: string): string {
    const accents = this.languageGroups.find((group) => group.languageCode === languageCode)?.accents ?? [];
    const configured = this.plugin.settings.preferredAccentCode;
    return accents.some((accent) => accent.code === configured) ? configured : accents[0]?.code ?? "";
  }
}

async function waitForVoices(): Promise<TtsReaderVoice[]> {
  const browserVoices = await waitForBrowserVoices();
  return getServerAndBrowserVoices(browserVoices);
}

function getServerAndBrowserVoices(browserVoices?: SpeechSynthesisVoice[]): TtsReaderVoice[] {
  const client = new TtsReaderClient();
  return client.listVoices(browserVoices);
}

function getAllVoices(): TtsReaderVoice[] {
  return getServerAndBrowserVoices();
}

async function waitForBrowserVoices(): Promise<SpeechSynthesisVoice[]> {
  const immediate = speechSynthesis.getVoices();
  if (immediate.length > 0) {
    return immediate;
  }

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => resolve(speechSynthesis.getVoices()), 1000);
    speechSynthesis.onvoiceschanged = () => {
      window.clearTimeout(timeout);
      resolve(speechSynthesis.getVoices());
    };
  });
}
