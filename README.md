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
- Track the website-style premium playback quota: `Used x / 5,000 chars for premium voices.`
- Optionally use a TTSReader `UAPI-*` key for export mode.

## Installation

### From a GitHub release

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Create this folder in your vault:

   ```text
   <your vault>/.obsidian/plugins/obsidian-ttsreader/
   ```

3. Put the three files into that folder.
4. Restart Obsidian and enable `Obsidian TTSReader` in Community plugins.

### From source

```bash
npm install
npm run build
```

Then copy these files into your vault plugin folder:

```text
dist/main.js -> <your vault>/.obsidian/plugins/obsidian-ttsreader/main.js
manifest.json -> <your vault>/.obsidian/plugins/obsidian-ttsreader/manifest.json
styles.css -> <your vault>/.obsidian/plugins/obsidian-ttsreader/styles.css
```

## Usage

- Open the ribbon icon or run `Open TTSReader`.
- Select text and run `Read the selected text`.
- Right-click selected editor text and choose `Read the selected text`.
- Use `Stop TTSReader playback` to stop audio.

## Premium voices and sign-in

The plugin can open the TTSReader sign-in page from settings, but Obsidian cannot read Google/Apple login cookies from your external browser session.

For authenticated server voices, paste one credential into `Authorization / UAPI Key`:

- `UAPI-...`: Uses the official TTSReader UAPI export path.
- `Bearer eyJ...`: Uses the TTSReader cloud playback endpoint with the pasted bearer token.

The bearer token is not a Cookie, can expire, and should be treated like a password. Cloud playback mirrors the website test/playback path and tracks premium usage locally against the 5,000 character limit shown in the UI.

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
