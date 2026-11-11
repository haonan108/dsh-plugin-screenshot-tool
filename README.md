# dsh-plugin-screenshot-tool

A WeChat-style screenshot button for the DeepSeek Harness Web UI. It sits in the composer's
tool row, captures a region of the macOS screen with the native crosshair, puts the PNG on the
clipboard **and** inserts it into the composer as a draft attachment — ready to send.

> 输入框工具栏里的微信式截图插件：原生框选屏幕区域，图片自动进剪贴板并直接放入输入框，按 Enter 即可发送。

## Features

- **Resident split button** in the composer tool row: click the scissors to capture, click the
  caret to pick a capture mode (hidden window / visible window). The choice is remembered.
- **Native region capture** — macOS `screencapture -i`: drag to select, press Space to switch to
  window mode, Esc to cancel. No browser screen-share picker.
- **Hidden-window mode** (default): the Harness window is hidden while you select and restored
  afterwards, even on cancel, timeout or failure.
- **Clipboard + composer attachment**: the result is copied to the clipboard and a synthetic paste
  places the PNG into the composer draft. If no composer editor is present, the clipboard copy is
  the fallback.
- **Screen Recording preflight**: reads the macOS TCC database first. When capture is not allowed,
  the tool refuses instead of returning a wallpaper-only image, and offers a button that opens the
  Screen Recording settings pane.
- **Light/dark aware**: chrome colors use the host's `--dsw-alias-*` theme tokens only. UI text is
  localized (English and Simplified Chinese) through the Client locale service.

## Requirements

- macOS 13 or newer (native capture and window hiding are macOS-only).
- DeepSeek Harness `>= 0.2.2-rc.1` (Web GUI).
- **Screen Recording** permission for the Harness application
  (System Settings → Privacy & Security → Screen Recording), then quit and reopen the app.
- **Automation → System Events** permission for the hidden-window mode
  (System Settings → Privacy & Security → Automation). The first hidden capture asks once; without
  it the capture still works, just with the window visible, and the result card says so.

In a plain `dsh web` host there is no application window to hide, so the hidden-window mode
degrades to a normal capture.

## Install

```sh
dsh plugin add dsh-plugin-screenshot-tool
```

Then reload the Web GUI once. Other ways to install it:

```sh
# straight from the repository (works even when a registry mirror lags behind)
dsh plugin add https://github.com/haonan108/dsh-plugin-screenshot-tool

# from a local checkout
dsh plugin add /absolute/path/to/dsh-plugin-screenshot-tool
```

Uninstall with `dsh plugin remove dsh-plugin-screenshot-tool` (or remove the bundle from the
profile's patch layer) and reload the page.

## Usage

1. Click the scissors in the composer's tool row. The Harness window hides and macOS shows its
   selection crosshair.
2. Drag the region to capture (Space toggles window mode, Esc cancels).
3. The window comes back, the PNG is on the clipboard, and the image appears in the composer as a
   draft attachment. Press Enter to send.
4. Choose 「隐藏窗口截图」/「不隐藏窗口截图」 (“capture with the window hidden” / “with the window
   visible”) from the caret menu. The last choice becomes the default for the next click.

## Privacy and security

- The plugin is two halves: a Host half (`index.js`) that runs in the Harness process and a browser
  half (`client.js`) rendered in the Web UI. It adds no agent tools and no model-facing prompt text.
- The Host half registers four loopback-only routes under `/screenshot-tool/api/`: `capture`,
  `permission`, `permission-settings` and a diagnostics `health`/`hello` pair. All of them refuse
  requests whose `Sec-Fetch-Site` shows another site's page, and the capture route serializes one
  native selection at a time.
- Screen Recording state is read from the system TCC database (`/Library/Application Support/com.apple.TCC/TCC.db`),
  which is world-readable; the query is limited to the `kTCCServiceScreenCapture` rows for this
  application. Nothing else is read.
- Each capture is written to a temporary file under `/tmp/dsh-screenshot-tool/`, put on the
  clipboard with `osascript`, and then deleted. The Host never keeps the image.
- The hidden-window mode asks System Events to hide and re-show the Harness window by its process
  id; it does not click, type, or read other applications.

## Package layout

| File | Role |
|---|---|
| `package.json` | Bundle manifest: `dsh.bundle.patch` plus `dsh.client` for the browser half |
| `cordis.patch.yml` | Inserts the `screenshot-tool` loader row |
| `index.js` | Host half: capture, clipboard, permissions, window hide/restore, HTTP routes |
| `client.js` | Browser half: split button in `conversation.input.left`, dropdown and result card in `shell.overlay` |
| `locale/en.json`, `locale/zh.json` | Plugin Manager title and description |
| `icon.svg` | WeChat-style green scissors icon |

Both halves are plain JavaScript with no build step; `client.js` is a module-loader bundle whose
factory id equals the package name.

## License

MIT — see [LICENSE](LICENSE).
