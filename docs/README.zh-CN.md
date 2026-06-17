# TTSReader Obsidian 插件

TTSReader 可以在 Obsidian 中朗读笔记内容。你可以朗读选中的文本、当前笔记，或者在阅读窗口中粘贴一段文本后播放。

[English README](../README.md)

## 它能做什么

- 朗读编辑器中选中的文本。
- 没有选中文本时，可以朗读当前笔记。
- 在命令面板和编辑器右键菜单中提供 `Read the selected text`。
- 按平台、语言、地区/口音、Basic/Premium 筛选阅读者。
- 在正式播放前试听当前阅读者的示例语音。
- 在 Obsidian 状态栏显示播放状态和错误信息。
- 缓存最近生成过的音频，重复播放同一段内容时减少 API 请求。

## 支持的平台

### Boson Higgs Audio

Boson Higgs Audio 是新安装时的默认平台。

如果你希望使用云端 TTS，并使用 Boson 的预设声音，可以选择这个平台。目前内置这些声音：

- Chloe
- Eleanor
- Jake
- Marcus
- Nora
- Oliver

你需要配置 Boson API Key。打开插件设置，选择 `Boson Higgs Audio`，然后把 Key 粘贴到 `Boson API key`。也可以点击旁边的 `Guide` 打开 Boson API Key 页面。

### TTSReader

TTSReader 平台提供浏览器语音和 TTSReader 服务端语音。

适合这些场景：

- 使用当前 Obsidian 桌面环境暴露出来的浏览器/Web Speech 语音。
- 使用 TTSReader 服务端语音。
- 通过 UAPI Key、Bearer Token 或 Firebase Refresh Token 使用 TTSReader 账号授权。

插件不会在本地拦截 TTSReader Premium 配额。如果某个声音不可用，或者额度不足，会由 TTSReader API 返回错误，插件会把错误显示出来。

## 安装

### 从 GitHub Release 安装

1. 打开最新版本：<https://github.com/sundy-li/obsidian-ttsreader/releases/latest>
2. 下载这三个文件：
   - `main.js`
   - `manifest.json`
   - `styles.css`
3. 在你的 Obsidian vault 中创建这个目录：

   ```text
   <你的 vault>/.obsidian/plugins/ttsreader/
   ```

4. 把下载的三个文件放进这个目录。
5. 重启 Obsidian。
6. 打开 `Settings` -> `Community plugins`。
7. 启用 `TTSReader`。

## 快速开始

1. 打开 `Settings` -> `TTSReader`。
2. 选择一个语音平台。
3. 填入这个平台需要的 API Key 或授权信息。
4. 选择一个阅读者。
5. 在笔记中选中一段文本。
6. 从命令面板或编辑器右键菜单运行 `Read the selected text`。

你也可以点击左侧 ribbon 图标，或者运行 `Open TTSReader` 打开阅读窗口。阅读窗口里可以输入文本、切换平台、切换阅读者、试听语音和播放文本。

## 配置 Boson

1. 打开 `Settings` -> `TTSReader`。
2. 将 `Text-to-speech platform` 设置为 `Boson Higgs Audio`。
3. 将 Boson API Key 粘贴到 `Boson API key`。
4. 如果需要确认内容，可以点击 `Show` 显示输入值。
5. 如果需要获取 API Key，可以点击 `Guide` 打开 Boson API Key 页面。
6. 选择一个阅读者。

Boson API Key 通常以 `bai-` 开头。

## 配置 TTSReader

1. 打开 `Settings` -> `TTSReader`。
2. 将 `Text-to-speech platform` 设置为 `TTSReader`。
3. 选择一种授权方式：
   - `Authorization / UAPI Key`：粘贴 `UAPI-...` Key，或者短期有效的 `Bearer eyJ...` Token。
   - `Firebase API key` 加 `Firebase refresh token`：插件可以自动刷新短期有效的云端播放 Token。
4. 选择一个阅读者。

如果要获取 Firebase API Key 和 Refresh Token，可以看 [Firebase credentials](firebase-credentials.md)。

Bearer Token、Firebase Refresh Token、UAPI Key 和 Boson API Key 都应该当作密码保存，不要公开分享。

## 关于声音列表

插件中的 Basic 声音列表表示“当前 Obsidian 桌面环境实际可以播放的声音”。

TTSReader 官网里有些 Basic 声音来自浏览器，比如 Aria、Michelle、Jenny 等。Obsidian 使用 Electron 运行，所以这些声音只有在 Electron 通过 `speechSynthesis.getVoices()` 暴露出来时才会显示。插件不会伪造当前环境不能播放的浏览器声音。

Boson 的声音是云端预设声音，不依赖浏览器声音列表。

## 命令

- `Open TTSReader`：打开阅读窗口。
- `Read the selected text`：朗读当前选中的编辑器文本。
- `Speak selection or current note`：朗读选中文本；如果没有选中文本，则朗读当前笔记。
- `Stop TTSReader playback`：停止当前播放。
- `Open TTSReader sign-in page`：打开 TTSReader 网站登录页面。

## 常见问题

### 点击播放后没有声音

- 检查当前平台是否已经配置正确的授权信息。
- 对当前阅读者点击 `Play sample` 试一下。
- 查看 Obsidian 状态栏或弹出的 Notice，插件会显示具体错误。
- 如果使用 Boson，确认 API Key 是否以 `bai-` 开头。
- 如果使用 TTSReader 服务端声音，确认是否有有效的 UAPI Key、Bearer Token 或 Firebase Refresh Token。

### TTSReader 官网有某个声音，但插件里没有

这个声音可能是浏览器提供的声音，只在 Chrome、Edge 或 Safari 中可用，但不一定在 Obsidian/Electron 中可用。插件只显示 Obsidian 当前能实际播放的浏览器声音。

### TTSReader Authorization 很快过期

短期 Bearer Token 会很快过期。如果希望插件自动刷新授权，建议使用 `Firebase API key` 加 `Firebase refresh token`。

### Premium 声音播放失败

插件不会在本地限制 Premium 用量。账号权限、声音权限和额度由 API 返回结果决定。如果失败，插件会显示 API 返回的错误信息。

## 隐私和密钥安全

密钥会保存在这个插件的 Obsidian 插件数据中。任何能读取你的 vault 配置文件的人，都可能读取到这些密钥。不要公开发布你的 `.obsidian/plugins/ttsreader/data.json`。

使用 Boson Higgs Audio 或 TTSReader 服务端声音时，插件会把要朗读的文本发送给对应的云端服务。浏览器声音则由 Obsidian 暴露的本地 Web Speech 运行时处理。

## License

MIT
