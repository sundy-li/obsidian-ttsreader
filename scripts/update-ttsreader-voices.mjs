import fs from "node:fs/promises";

const PLAYER_URL = "https://ttsreader.com/player/";
const BUNDLE_RE = /(?:src|href)="([^"]+static\/js\/main\.[^"]+\.js)"/;

const html = await fetchText(PLAYER_URL);
const bundlePath = html.match(BUNDLE_RE)?.[1];
if (!bundlePath) {
  throw new Error("Could not find TTSReader main bundle URL.");
}

const bundleUrl = new URL(bundlePath, PLAYER_URL).href;
const bundle = await fetchText(bundleUrl);
const voices = extractServerVoices(bundle);

const generated = `// Generated from ${bundleUrl}
// Run: npm run update:voices
// Do not edit by hand.

export interface TtsReaderServerVoiceRecord {
  voiceURI: string;
  name: string;
  lang: string;
  premiumLevel: number;
  gender?: string;
  avatar?: string;
  demo?: string;
}

export const TTSREADER_SERVER_VOICES = ${JSON.stringify(voices, null, 2)} as const satisfies readonly TtsReaderServerVoiceRecord[];
`;

await fs.writeFile(new URL("../src/ttsreader-voices.generated.ts", import.meta.url), generated);
console.log(`Wrote ${voices.length} TTSReader server voices from ${bundleUrl}`);

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function extractServerVoices(bundle) {
  const moduleStart = bundle.indexOf('9302(e,a,t){');
  const moduleEnd = bundle.indexOf('},7255(e,a,t)', moduleStart);
  if (moduleStart < 0 || moduleEnd < 0) {
    throw new Error("Could not locate TTSReader ServerVoices module.");
  }

  const moduleSource = bundle.slice(moduleStart, moduleEnd);
  const wellsrc = extractWellsrcVoices(moduleSource);
  const explicit = extractExplicitVoices(moduleSource);

  return [...wellsrc, ...explicit];
}

function extractWellsrcVoices(moduleSource) {
  const idsText = moduleSource.match(/const o=\[(.*?)\]\.filter\(e=>-1===e\.id\.indexOf\("_v0"\)\)/)?.[1];
  if (!idsText) {
    throw new Error("Could not locate wellsrc voices.");
  }

  const languageMap = {
    a: "en-US",
    b: "en-GB",
    e: "es-ES",
    f: "fr-FR",
    h: "hi-IN",
    i: "it-IT",
    j: "ja-JP",
    p: "pt-BR",
    z: "zh-CN",
  };

  return [...idsText.matchAll(/\{id:"([^"]+)",name:"[^"]+"\}/g)]
    .map((match) => match[1])
    .filter((id) => !id.includes("_v0"))
    .map((id) => {
      const [prefix, rawName = ""] = id.split("_");
      return {
        voiceURI: `ttsreaderServer.wellsrc.${id}`,
        name: `wAI ${titleCase(rawName)}`,
        lang: languageMap[prefix.charAt(0)] ?? "en-US",
        premiumLevel: 2,
        gender: prefix.charAt(1),
      };
    });
}

function extractExplicitVoices(moduleSource) {
  return [
    ...moduleSource.matchAll(
      /\{voiceURI:"([^"]+)",name:"([^"]+)",lang:"([^"]+)",localService:!1,default:!0,premiumLevel:(\d+)(?:,gender:"([^"]+)")?(?:,avatar:"([^"]+)")?(?:,demo:"([^"]+)")?/g,
    ),
  ].map((match) => ({
    voiceURI: match[1],
    name: match[2],
    lang: match[3],
    premiumLevel: Number(match[4]),
    ...(match[5] ? { gender: match[5] } : {}),
    ...(match[6] ? { avatar: match[6] } : {}),
    ...(match[7] ? { demo: match[7] } : {}),
  }));
}

function titleCase(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
