import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TtsReaderClient,
  getBundledServerVoices,
  getBrowserVoices,
  isServerVoice,
  normalizeRate,
  refreshFirebaseIdToken,
} from "../src/sdk.js";

describe("TTSReader SDK", () => {
  it("exposes bundled server voices with paid/free metadata", () => {
    const voices = getBundledServerVoices();

    assert.ok(voices.length >= 100);
    assert.ok(voices.some((voice) => voice.id === "ttsreaderServer.gcp.en-US-Chirp-HD-D"));
    assert.ok(voices.some((voice) => voice.id === "ttsreaderServer.azure.es-MX-DaliaNeural"));
    assert.ok(voices.some((voice) => voice.id === "ttsreaderServer.gcp.en-GB-Standard-A"));
    assert.ok(voices.every((voice) => voice.source === "ttsreader-server"));
    assert.ok(voices.every((voice) => typeof voice.isPremium === "boolean"));
  });

  it("normalizes browser voices without mutating the source objects", () => {
    const raw = [
      { voiceURI: "com.apple.speech.synthesis.voice.samantha", name: "Samantha", lang: "en-US", localService: true },
    ] as SpeechSynthesisVoice[];

    const voices = getBrowserVoices(raw);

    assert.deepEqual(voices, [
      {
        id: "com.apple.speech.synthesis.voice.samantha",
        name: "Samantha",
        lang: "en-US",
        source: "browser",
        isPremium: false,
        localService: true,
      },
    ]);
    assert.equal((raw[0] as SpeechSynthesisVoice & { source?: string }).source, undefined);
  });

  it("builds the anonymous cloud playback request", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    };
    const client = new TtsReaderClient({ fetch: fetcher });

    const audio = await client.synthesize({
      text: "Hello",
      voiceId: "ttsreaderServer.gcp.en-US-Chirp-HD-D",
      lang: "en-US",
      rate: 1.5,
      mode: "cloud-playback",
      isTest: true,
    });

    assert.equal(audio.contentType, "audio/mpeg");
    assert.equal(audio.bytes.byteLength, 3);
    assert.equal(calls[0].url, "https://us-central1-ttsreader.cloudfunctions.net/tts");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      text: "Hello",
      lang: "en-US",
      voice: "ttsreaderServer.gcp.en-US-Chirp-HD-D",
      rate: 1,
      isTest: true,
    });
  });

  it("binds the default fetch to globalThis for browser runtimes", async () => {
    const originalFetch = globalThis.fetch;
    try {
      const calls: Array<{ thisValue: unknown; url: string }> = [];
      globalThis.fetch = (async function boundFetchProbe(this: unknown, url: RequestInfo | URL) {
        calls.push({ thisValue: this, url: String(url) });
        return new Response(new Uint8Array([7, 8, 9]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
      }) as typeof fetch;

      const client = new TtsReaderClient();
      const audio = await client.synthesize({
        text: "Hello",
        voiceId: "ttsreaderServer.gcp.en-US-Chirp-HD-D",
        lang: "en-US",
        mode: "cloud-playback",
      });

      assert.equal(audio.bytes.byteLength, 3);
      assert.equal(calls[0].thisValue, globalThis);
      assert.equal(calls[0].url, "https://us-central1-ttsreader.cloudfunctions.net/tts");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("defaults cloud playback to custom text synthesis instead of test voice playback", async () => {
    const calls: Array<{ init: RequestInit }> = [];
    const fetcher: typeof fetch = async (_url, init) => {
      calls.push({ init: init ?? {} });
      return new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    };
    const client = new TtsReaderClient({ fetch: fetcher });

    await client.synthesize({
      text: "Hello",
      voiceId: "ttsreaderServer.gcp.en-US-Chirp-HD-D",
      lang: "en-US",
      mode: "cloud-playback",
    });

    assert.equal(JSON.parse(String(calls[0].init.body)).isTest, false);
  });

  it("adds the cloud playback bearer token when provided", async () => {
    const calls: Array<{ init: RequestInit }> = [];
    const fetcher: typeof fetch = async (_url, init) => {
      calls.push({ init: init ?? {} });
      return new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    };
    const client = new TtsReaderClient({ cloudBearerToken: "Bearer cloud-token", fetch: fetcher });

    await client.synthesize({
      text: "Hello",
      voiceId: "ttsreaderServer.azure.en-US-DavisMultilingualNeural",
      lang: "en-US",
      mode: "cloud-playback",
    });

    assert.equal(new Headers(calls[0].init.headers).get("authorization"), "Bearer cloud-token");
    assert.equal(JSON.parse(String(calls[0].init.body)).isTest, false);
  });

  it("does not send a cloud bearer token to the UAPI endpoint", async () => {
    const calls: Array<{ init: RequestInit }> = [];
    const fetcher: typeof fetch = async (_url, init) => {
      calls.push({ init: init ?? {} });
      return new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    };
    const client = new TtsReaderClient({ apiKey: "abc123", cloudBearerToken: "cloud-token", fetch: fetcher });

    await client.synthesize({
      text: "Hello",
      voiceId: "Nova Premium",
      lang: "en-US",
      mode: "uapi-export",
    });

    assert.equal(new Headers(calls[0].init.headers).get("authorization"), "Bearer UAPI-abc123");
  });

  it("builds the official UAPI export request when an API key is provided", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(new Uint8Array([4, 5, 6]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    };
    const client = new TtsReaderClient({ apiKey: "abc123", fetch: fetcher });

    await client.synthesize({
      text: "Hello",
      voiceId: "Nova Premium",
      lang: "en-US",
      rate: 0.8,
      mode: "uapi-export",
      quality: "48khz_192kbps",
    });

    assert.equal(calls[0].url, "https://ttsreader.com/api/ttsSync");
    assert.equal(new Headers(calls[0].init.headers).get("authorization"), "Bearer UAPI-abc123");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      text: "Hello",
      lang: "en-US",
      voice: "Nova Premium",
      rate: 0.8,
      quality: "48khz_192kbps",
    });
  });

  it("refreshes a Firebase ID token with a refresh token", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({
        id_token: "fresh-id-token",
        refresh_token: "fresh-refresh-token",
        expires_in: "3600",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await refreshFirebaseIdToken({
      apiKey: "firebase-api-key",
      refreshToken: "old-refresh-token",
      fetch: fetcher,
    });

    assert.deepEqual(result, {
      idToken: "fresh-id-token",
      refreshToken: "fresh-refresh-token",
      expiresIn: 3600,
    });
    assert.equal(calls[0].url, "https://securetoken.googleapis.com/v1/token?key=firebase-api-key");
    assert.equal(new Headers(calls[0].init.headers).get("content-type"), "application/x-www-form-urlencoded");
    assert.equal(String(calls[0].init.body), "grant_type=refresh_token&refresh_token=old-refresh-token");
  });

  it("surfaces Firebase refresh error messages clearly", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      error: {
        code: 400,
        message: "INVALID_REFRESH_TOKEN",
        status: "INVALID_ARGUMENT",
      },
    }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });

    await assert.rejects(
      refreshFirebaseIdToken({
        apiKey: "firebase-api-key",
        refreshToken: "bad-refresh-token",
        fetch: fetcher,
      }),
      /Firebase token refresh failed: 400 - INVALID_REFRESH_TOKEN/,
    );
  });

  it("classifies server voice ids and clamps rates like the player", () => {
    assert.equal(isServerVoice("ttsreaderServer.gcp.en-US-Chirp-HD-D"), true);
    assert.equal(isServerVoice("azure.en-US-AriaNeural"), true);
    assert.equal(isServerVoice("com.apple.samantha"), false);
    assert.equal(normalizeRate(0), 0.1);
    assert.equal(normalizeRate(9), 4);
  });
});
