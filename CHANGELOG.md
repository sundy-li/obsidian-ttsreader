# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Documentation

- Reworked the README as a user guide.
- Added a Chinese user guide.
- Added settings page and command palette screenshots to the English and Chinese user guides.

### Removed

- Removed the TTSReader premium account sign-in shortcut from settings and commands.

## 0.1.8 - 2026-06-17

### Added

- Added Boson Higgs Audio as a text-to-speech provider.
- Added Boson preset voices: Chloe, Eleanor, Jake, Marcus, Nora, and Oliver.
- Added a Boson API key guide button that opens the Boson workspace API key page.
- Added Firebase API key and refresh token authentication for TTSReader cloud playback.
- Added full playback/auth error messages in the plugin UI.
- Added secret visibility toggles for credential fields.

### Changed

- Made Boson Higgs Audio the default provider for new installs.
- Changed provider settings so only the selected provider's credential fields are shown.
- Matched the Boson speech request payload to the official API shape.
- Removed local Premium character quota blocking and usage display; TTSReader API responses now decide quota and permission failures.

### Documentation

- Documented how to extract Firebase credentials from TTSReader browser storage.
