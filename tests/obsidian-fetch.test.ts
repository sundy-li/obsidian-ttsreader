import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { makeObsidianFetch } from "../src/obsidian-fetch.js";

describe("Obsidian requestUrl fetch adapter", () => {
  it("turns fetch-style requests into requestUrl calls and returns a Response", async () => {
    const calls: unknown[] = [];
    const requestUrl = (async (request: unknown) => {
      calls.push(request);
      return {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
        arrayBuffer: new Uint8Array([1, 2, 3]).buffer,
        json: null,
        text: "",
      };
    }) as unknown as Parameters<typeof makeObsidianFetch>[0];

    const fetcher = makeObsidianFetch(requestUrl);
    const response = await fetcher("https://example.test/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello" }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/mpeg");
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
    assert.deepEqual(calls, [
      {
        url: "https://example.test/tts",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"text":"Hello"}',
        contentType: "application/json",
        throw: false,
      },
    ]);
  });
});
