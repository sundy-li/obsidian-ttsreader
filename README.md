# Obsidian TTSReader

Read Obsidian notes aloud with browser voices or TTSReader-style server voices.

This project contains an Obsidian desktop plugin plus a small TypeScript SDK for the TTSReader playback/export endpoints.

## Features

- Read the selected text or the current note from Obsidian.
- Add `Read the selected text` to the command palette and editor right-click menu.
- Choose voices by language, region/accent, and `All` / `Premium` / `Basic`.
- Play a sample from the voice picker before reading.
- Use browser/Web Speech voices for local playback.
- Use bundled TTSReader server voices for cloud playback.
- Optionally use a TTSReader `UAPI-*` key, a temporary Bearer token, or Firebase refresh credentials for authenticated server playback.

## Installation

### From a GitHub release

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Create this folder in your vault:

   ```text
   <your vault>/.obsidian/plugins/ttsreader/
   ```

3. Put the three files into that folder.
4. Restart Obsidian and enable `TTSReader` in Community plugins.

### From source

```bash
npm install
npm run build
```

Then copy these files into your vault plugin folder:

```text
dist/main.js -> <your vault>/.obsidian/plugins/ttsreader/main.js
manifest.json -> <your vault>/.obsidian/plugins/ttsreader/manifest.json
styles.css -> <your vault>/.obsidian/plugins/ttsreader/styles.css
```

## Usage

- Open the ribbon icon or run `Open TTSReader`.
- Select text and run `Read the selected text`.
- Right-click selected editor text and choose `Read the selected text`.
- Use `Stop TTSReader playback` to stop audio.

## Premium voices and sign-in

The plugin can open the TTSReader sign-in page from settings, but Obsidian cannot read Google/Apple login cookies from your external browser session.

For authenticated server voices, use one of these credential options:

- `UAPI-...`: Uses the official TTSReader UAPI export path.
- `Bearer eyJ...`: Uses the TTSReader cloud playback endpoint with the pasted bearer token.
- `Firebase API key` + `Firebase refresh token`: Refreshes the short-lived cloud playback Bearer token automatically.

Bearer and Firebase refresh tokens are not Cookies and should be treated like passwords. Cloud playback mirrors the website test/playback path; account permissions and quota errors come from the TTSReader API response.

The Basic voice list shows voices that the current Obsidian runtime can actually play. Some Basic voices shown on the TTSReader website, such as browser-provided Aria or Michelle voices, may not appear in Obsidian if Electron does not expose them through `speechSynthesis.getVoices()`.

See [Firebase credentials](docs/firebase-credentials.md) for copy-paste Console snippets that extract the API key and refresh token from a signed-in TTSReader browser session.

## Development

```bash
npm test
npm run check
npm run build
npm run update:voices
```

`npm run update:voices` refreshes the generated TTSReader server voice list from the website bundle.

## License

MIT
