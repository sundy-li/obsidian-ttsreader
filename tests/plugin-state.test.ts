import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_SETTINGS,
  AUDIO_CACHE_LIMIT,
  buildAudioCacheKey,
  chooseInitialVoiceId,
  filterVoicesForSelection,
  fingerprintCredential,
  formatPremiumUsage,
  getBoundedCacheEntry,
  getCredentialKind,
  getCredentialParts,
  getVoiceDemoUrl,
  getPremiumUsageAfterRead,
  getReadableText,
  groupVoicesByLanguage,
  mergeSettings,
  putBoundedCacheEntry,
  resolveServerCustomTextMode,
  shouldCountPremiumUsage,
} from "../src/plugin-state.js";

describe("plugin state helpers", () => {
  it("keeps known settings while filling new defaults", () => {
    assert.deepEqual(
      mergeSettings({ defaultRate: 1.25, preferredVoiceId: "voice-a" }),
      { ...DEFAULT_SETTINGS, defaultRate: 1.25, preferredVoiceId: "voice-a" },
    );
  });

  it("migrates old authorization fields into the unified credential", () => {
    assert.equal(mergeSettings({ apiKey: "abc123" }).credential, "abc123");
    assert.equal(mergeSettings({ cloudBearerToken: "token.jwt" }).credential, "token.jwt");
    assert.equal(mergeSettings({ credential: "UAPI-live" }).credential, "UAPI-live");
  });

  it("chooses the preferred voice only when it exists", () => {
    const voices = [
      { id: "voice-a", name: "A", lang: "en-US", source: "browser" as const, isPremium: false },
      { id: "voice-b", name: "B", lang: "en-US", source: "ttsreader-server" as const, isPremium: true },
    ];

    assert.equal(chooseInitialVoiceId(voices, "voice-b"), "voice-b");
    assert.equal(chooseInitialVoiceId(voices, "missing"), "voice-a");
  });

  it("prefers selected editor text over full note text", () => {
    assert.equal(getReadableText("full note", " selected "), "selected");
    assert.equal(getReadableText(" full note ", ""), "full note");
  });

  it("groups voices into language and region/accent selectors", () => {
    const groups = groupVoicesByLanguage([
      { id: "john", name: "John Premium", lang: "en-US", source: "ttsreader-server", isPremium: true },
      { id: "olivia", name: "Olivia Premium", lang: "en-GB", source: "ttsreader-server", isPremium: true },
      { id: "samantha", name: "Samantha", lang: "en-US", source: "browser", isPremium: false },
      { id: "saul", name: "Saul", lang: "es-ES", source: "ttsreader-server", isPremium: true },
    ]);

    const english = groups.find((group) => group.languageCode === "en");
    assert.ok(english);
    assert.equal(english.name, "English");
    assert.deepEqual(
      english.accents.map((accent) => [accent.code, accent.name]),
      [
        ["en-US", "United States"],
        ["en-GB", "United Kingdom"],
      ],
    );
    assert.ok(groups.some((group) => group.languageCode === "es" && group.name === "Spanish"));
  });

  it("filters voices by language, accent, and premium/basic selection", () => {
    const voices = [
      { id: "john", name: "John Premium", lang: "en-US", source: "ttsreader-server" as const, isPremium: true },
      { id: "olivia", name: "Olivia Premium", lang: "en-GB", source: "ttsreader-server" as const, isPremium: true },
      { id: "samantha", name: "Samantha", lang: "en-US", source: "browser" as const, isPremium: false },
    ];

    assert.deepEqual(
      filterVoicesForSelection(voices, { languageCode: "en", accentCode: "en-US", voiceFilter: "premium" }).map(
        (voice) => voice.id,
      ),
      ["john"],
    );
    assert.deepEqual(
      filterVoicesForSelection(voices, { languageCode: "en", accentCode: "en-US", voiceFilter: "basic" }).map(
        (voice) => voice.id,
      ),
      ["samantha"],
    );
    assert.deepEqual(
      filterVoicesForSelection(voices, { languageCode: "en", accentCode: "", voiceFilter: "all" }).map(
        (voice) => voice.id,
      ),
      ["john", "olivia", "samantha"],
    );
  });

  it("tracks premium character usage against the website playback quota", () => {
    assert.equal(formatPremiumUsage(424), "Used 424 / 5,000 chars for premium voices.");
    assert.deepEqual(getPremiumUsageAfterRead(4900, "  hello world  "), {
      used: 4911,
      limit: 5000,
      remaining: 89,
      exceeded: false,
    });
    assert.deepEqual(getPremiumUsageAfterRead(4998, "hello"), {
      used: 5003,
      limit: 5000,
      remaining: 0,
      exceeded: true,
    });
  });

  it("counts premium usage only when authenticated export can read custom server text", () => {
    assert.equal(shouldCountPremiumUsage(true, "uapi-export"), true);
    assert.equal(shouldCountPremiumUsage(true, "cloud-playback"), false);
    assert.equal(shouldCountPremiumUsage(true, "cloud-playback", "cloud-bearer"), true);
    assert.equal(shouldCountPremiumUsage(false, "uapi-export"), false);
  });

  it("requires UAPI export for custom text with TTSReader server voices", () => {
    assert.equal(resolveServerCustomTextMode("cloud-playback", false), "");
    assert.equal(resolveServerCustomTextMode("cloud-playback", true), "uapi-export");
    assert.equal(resolveServerCustomTextMode("uapi-export", false), "uapi-export");
    assert.equal(resolveServerCustomTextMode("cloud-playback", false, true), "cloud-playback");
    assert.equal(resolveServerCustomTextMode("uapi-export", true, true), "cloud-playback");
  });

  it("detects the authorization credential type from one input", () => {
    assert.equal(getCredentialKind(""), "none");
    assert.equal(getCredentialKind("UAPI-abc123"), "uapi-key");
    assert.equal(getCredentialKind("Bearer UAPI-abc123"), "uapi-key");
    assert.equal(getCredentialKind("Bearer eyJhbGciOiJSUzI1NiJ9.payload.signature"), "cloud-bearer");
    assert.deepEqual(getCredentialParts("UAPI-abc123"), { kind: "uapi-key", apiKey: "abc123" });
    assert.deepEqual(getCredentialParts("Bearer cloud-token"), {
      kind: "cloud-bearer",
      cloudBearerToken: "cloud-token",
    });
  });

  it("builds stable audio cache keys with authorization fingerprints", () => {
    const key = buildAudioCacheKey({
      text: "  Hello  ",
      voiceId: "voice-a",
      lang: "en-US",
      rate: 1,
      mode: "cloud-playback",
      isTest: false,
      credentialKind: "cloud-bearer",
      credentialFingerprint: fingerprintCredential("secret-token"),
    });

    assert.equal(key, buildAudioCacheKey({
      text: "Hello",
      voiceId: "voice-a",
      lang: "en-US",
      rate: 1,
      mode: "cloud-playback",
      isTest: false,
      credentialKind: "cloud-bearer",
      credentialFingerprint: fingerprintCredential("secret-token"),
    }));
    assert.notEqual(fingerprintCredential("secret-token"), fingerprintCredential("other-token"));
  });

  it("keeps only the most recent audio cache entries and refreshes hits", () => {
    const cache = new Map<string, number>();
    for (let index = 0; index < AUDIO_CACHE_LIMIT; index += 1) {
      putBoundedCacheEntry(cache, `key-${index}`, index);
    }

    assert.equal(getBoundedCacheEntry(cache, "key-0"), 0);
    putBoundedCacheEntry(cache, "key-new", 99);

    assert.equal(cache.size, AUDIO_CACHE_LIMIT);
    assert.equal(cache.has("key-1"), false);
    assert.equal(cache.has("key-0"), true);
    assert.equal(cache.has("key-new"), true);
  });

  it("builds absolute demo audio URLs for voice sample playback", () => {
    assert.equal(
      getVoiceDemoUrl({
        id: "ttsreaderServer.gcp.en-US-Chirp-HD-D",
        name: "John Premium",
        lang: "en-US",
        source: "ttsreader-server",
        isPremium: true,
        demo: "/audio/ttsreaderServer.gcp.en-US-Chirp-HD-D.mp3",
      }),
      "https://ttsreader.com/audio/ttsreaderServer.gcp.en-US-Chirp-HD-D.mp3",
    );
    assert.equal(
      getVoiceDemoUrl({
        id: "samantha",
        name: "Samantha",
        lang: "en-US",
        source: "browser",
        isPremium: false,
      }),
      "",
    );
  });
});
