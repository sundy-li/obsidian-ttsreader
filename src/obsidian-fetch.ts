import type { RequestUrlParam, RequestUrlResponsePromise } from "obsidian";

type RequestUrlFn = (request: RequestUrlParam | string) => RequestUrlResponsePromise;

export function makeObsidianFetch(requestUrlFn: RequestUrlFn): typeof fetch {
  return async (input, init = {}) => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const headers = headersToRecord(init.headers);
    const body = init.body ?? undefined;

    if (body != null && typeof body !== "string" && !(body instanceof ArrayBuffer)) {
      throw new Error("Obsidian requestUrl fetch adapter only supports string and ArrayBuffer bodies.");
    }

    const response = await requestUrlFn({
      url,
      method: init.method ?? "GET",
      headers,
      body,
      contentType: headers["Content-Type"] ?? headers["content-type"],
      throw: false,
    });

    return new Response(response.arrayBuffer, {
      status: response.status,
      headers: response.headers,
    });
  };
}

function headersToRecord(headersInit: HeadersInit | undefined): Record<string, string> {
  if (!headersInit) {
    return {};
  }

  const headers: Record<string, string> = {};
  new Headers(headersInit).forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}
