/**
 * Host half of the screenshot tool.
 *
 * The Web page cannot capture the screen itself: the desktop shell denies every
 * display-media, clipboard and download permission. So the capture runs here, in
 * the Host process, with macOS's own `screencapture -i` — the same interactive
 * crosshair selection WeChat uses — and the result is put on the clipboard by
 * `osascript` before the PNG bytes travel back to the page for its preview card.
 *
 * macOS screen capture needs the Screen Recording authorization. Without it
 * `screencapture` succeeds but returns the wallpaper layer only, which looks like
 * a working capture. The system TCC database records that decision, so the tool
 * reads it first and sends the page to System Settings instead of capturing.
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROUTE_CAPTURE = '/screenshot-tool/api/capture';
const ROUTE_HEALTH = '/screenshot-tool/api/health';
const ROUTE_HELLO = '/screenshot-tool/api/hello';
const ROUTE_PERMISSION = '/screenshot-tool/api/permission';
const ROUTE_PERMISSION_SETTINGS = '/screenshot-tool/api/permission-settings';
const SCREENCAPTURE = '/usr/sbin/screencapture';
const SYSTEM_TCC_DB = '/Library/Application Support/com.apple.TCC/TCC.db';
const SCREEN_RECORDING_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
/** The bundle identity macOS attributes the capture to. */
const APPLICATION_BUNDLE_ID = 'com.deepseek.dsh';
const CAPTURE_TIMEOUT_MS = 5 * 60 * 1000;
const CLIPBOARD_TIMEOUT_MS = 10 * 1000;
const PERMISSION_CACHE_MS = 3000;
/** Time for the compositor to remove the hidden window from the captured screen. */
const WINDOW_HIDE_SETTLE_MS = 300;
/** Time to answer the one-time macOS Automation prompt for System Events. */
const AUTOMATION_TIMEOUT_MS = 90 * 1000;

/** Set when the browser half reaches this Host half; reported by the health route. */
let lastClientSeenAt = null;
/** One native selection at a time, whichever page or tab asks. */
let captureBusy = false;
/** Cached Screen Recording authorization: 'allowed' | 'denied' | 'not-requested' | 'unknown' | 'unsupported'. */
let screenRecordingCache = { at: 0, state: 'unknown' };

/** The Web routes only mount when a web carrier is composed. */
export function apply(ctx) {
  ctx.inject(['webServer'], (host) => {
    host.effect(() => host.webServer.register({
      kind: 'exact',
      path: ROUTE_HEALTH,
      handler: (request, response) => {
        if (request.method !== 'GET') {
          sendJson(response, 405, { ok: false, reason: 'method' }, { allow: 'GET' });
          return;
        }
        if (isForeignRequest(request)) {
          sendJson(response, 403, { ok: false, reason: 'forbidden' });
          return;
        }
        sendJson(response, 200, {
          ok: true,
          platform: process.platform,
          native: process.platform === 'darwin',
          windowControl: desktopAnchorPid() === null ? 'unavailable' : 'system-events',
          clientSeenAt: lastClientSeenAt,
        });
      },
    }), 'screenshot-tool: health route');

    host.effect(() => host.webServer.register({
      kind: 'exact',
      path: ROUTE_HELLO,
      handler: (request, response) => {
        if (request.method !== 'POST') {
          sendJson(response, 405, { ok: false, reason: 'method' }, { allow: 'POST' });
          return;
        }
        if (isForeignRequest(request)) {
          sendJson(response, 403, { ok: false, reason: 'forbidden' });
          return;
        }
        lastClientSeenAt = Date.now();
        sendJson(response, 200, { ok: true });
      },
    }), 'screenshot-tool: hello route');

    host.effect(() => host.webServer.register({
      kind: 'exact',
      path: ROUTE_PERMISSION,
      handler: (request, response) => {
        if (request.method !== 'GET') {
          sendJson(response, 405, { ok: false, reason: 'method' }, { allow: 'GET' });
          return;
        }
        if (isForeignRequest(request)) {
          sendJson(response, 403, { ok: false, reason: 'forbidden' });
          return;
        }
        screenRecordingState().then(
          (state) => sendJson(response, 200, { ok: true, screen: state }),
          () => sendJson(response, 200, { ok: true, screen: 'unknown' }),
        );
      },
    }), 'screenshot-tool: permission route');

    host.effect(() => host.webServer.register({
      kind: 'exact',
      path: ROUTE_PERMISSION_SETTINGS,
      handler: (request, response) => {
        if (request.method !== 'POST') {
          sendJson(response, 405, { ok: false, reason: 'method' }, { allow: 'POST' });
          return;
        }
        if (isForeignRequest(request)) {
          sendJson(response, 403, { ok: false, reason: 'forbidden' });
          return;
        }
        execFileAsync('/usr/bin/open', [SCREEN_RECORDING_SETTINGS], { timeout: 5000 }).then(
          () => sendJson(response, 200, { ok: true }),
          () => sendJson(response, 200, { ok: false, reason: 'open-failed' }),
        );
      },
    }), 'screenshot-tool: permission settings route');

    host.effect(() => host.webServer.register({
      kind: 'exact',
      path: ROUTE_CAPTURE,
      handler: (request, response) => {
        if (request.method !== 'POST') {
          sendJson(response, 405, { ok: false, reason: 'method' }, { allow: 'POST' });
          return;
        }
        if (isForeignRequest(request)) {
          sendJson(response, 403, { ok: false, reason: 'forbidden' });
          return;
        }
        if (captureBusy) {
          sendJson(response, 200, { ok: false, reason: 'busy' });
          return;
        }
        captureBusy = true;
        screenRecordingState().then(async (state) => {
          /* Refuse up front: an unauthorized capture only yields the wallpaper layer. */
          if (state === 'denied') return { ok: false, reason: 'permission' };
          if (state === 'unsupported') return { ok: false, reason: 'unsupported-platform' };
          if (shouldHideWindow(request)) return captureWithHiddenWindow();
          return { ...(await capture()), windowHidden: null };
        }).then(
          (payload) => sendJson(response, 200, payload),
          (error) => sendJson(response, 200, {
            ok: false,
            reason: 'capture-failed',
            detail: messageOf(error),
          }),
        ).finally(() => {
          captureBusy = false;
        });
      },
    }), 'screenshot-tool: capture route');
  });
}

/**
 * Run one interactive region capture.
 * @returns {Promise<object>} `{ ok: true, image, width, height, bytes, copied, permission }` or `{ ok: false, reason }`.
 */
async function capture() {
  if (process.platform !== 'darwin') return { ok: false, reason: 'unsupported-platform' };

  const directory = join(tmpdir(), 'dsh-screenshot-tool');
  await mkdir(directory, { recursive: true });
  const file = join(directory, `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);

  try {
    await execFileAsync(SCREENCAPTURE, ['-i', '-x', '-o', file], { timeout: CAPTURE_TIMEOUT_MS });
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.killed === true) {
      await discard(file);
      return { ok: false, reason: 'timeout' };
    }
    /*
     * Escape exits non-zero with no message and no file. A refused Screen Recording
     * permission also leaves no file, but prints a diagnostic — report it as such
     * so first use shows the System Settings instruction instead of staying silent.
     */
    if (await fileSize(file) <= 0) {
      const detail = stderrOf(error);
      await discard(file);
      return detail === ''
        ? { ok: false, reason: 'cancelled' }
        : { ok: false, reason: 'permission', detail };
    }
  }

  const bytes = await readFile(file).catch(() => null);
  if (bytes === null || bytes.length === 0) {
    await discard(file);
    return { ok: false, reason: 'cancelled' };
  }
  const size = pngSize(bytes);
  /* Copy before the temporary file is discarded: the pasteboard reads its bytes. */
  const copied = await copyImageToClipboard(file);
  await discard(file);

  /* A decision made while the selection was open decides whether the pixels are real. */
  const permission = await screenRecordingState({ fresh: true });

  return {
    ok: true,
    image: `data:image/png;base64,${bytes.toString('base64')}`,
    width: size.width,
    height: size.height,
    bytes: bytes.length,
    copied,
    permission,
  };
}

/**
 * Read this application's macOS Screen Recording authorization.
 *
 * The system TCC database is world-readable, and a missing row means the prompt
 * has not been answered yet — a capture attempt is then the right move, because
 * it is what raises the system prompt.
 * @param {{ fresh?: boolean }} [options]
 * @returns {Promise<string>} 'allowed' | 'denied' | 'not-requested' | 'unknown' | 'unsupported'
 */
async function screenRecordingState(options = {}) {
  if (process.platform !== 'darwin') return 'unsupported';
  const now = Date.now();
  if (options.fresh !== true && now - screenRecordingCache.at < PERMISSION_CACHE_MS) {
    return screenRecordingCache.state;
  }
  let state = 'unknown';
  try {
    const { stdout } = await execFileAsync('/usr/bin/sqlite3', [
      SYSTEM_TCC_DB,
      "select client, auth_value from access where service = 'kTCCServiceScreenCapture';",
    ], { timeout: 5000 });
    const rows = stdout.split('\n').filter((line) => line !== '').map((line) => line.split('|'));
    const preferred = rows.find((row) => row[0] === APPLICATION_BUNDLE_ID)
      || rows.find((row) => typeof row[0] === 'string' && row[0].indexOf('dsh') !== -1);
    if (preferred === undefined) state = 'not-requested';
    else state = String(preferred[1]).trim() === '2' ? 'allowed' : 'denied';
  } catch (error) {
    state = 'unknown';
  }
  screenRecordingCache = { at: now, state };
  return state;
}

/**
 * The desktop shell runs this Host as a Node child of the Electron main process, so
 * the application window belongs to this process's parent. Hiding that window for
 * the selection needs the one-time macOS Automation grant for System Events; when
 * the grant or the desktop shell is absent, the capture simply keeps the window.
 */
function desktopAnchorPid() {
  if (process.env.ELECTRON_RUN_AS_NODE !== '1') return null;
  return typeof process.ppid === 'number' && process.ppid > 1 ? process.ppid : null;
}

async function setApplicationVisible(visible) {
  const pid = desktopAnchorPid();
  if (pid === null) return false;
  const lines = [
    'tell application "System Events"',
    '  set target to first application process whose unix id is ' + pid,
    '  set visible of target to ' + (visible ? 'true' : 'false'),
  ];
  if (visible) lines.push('  set frontmost of target to true');
  lines.push('end tell');
  try {
    await execFileAsync('/usr/bin/osascript', ['-e', lines.join('\n')], { timeout: AUTOMATION_TIMEOUT_MS });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Hide this application's window, run one capture, then bring the window back.
 * Restoring runs even when the selection is cancelled, times out, or fails.
 */
async function captureWithHiddenWindow() {
  /* null = this Host owns no application window, so hiding does not apply. */
  const hidden = desktopAnchorPid() === null ? null : await setApplicationVisible(false);
  if (hidden === true) await delay(WINDOW_HIDE_SETTLE_MS);
  try {
    return { ...(await capture()), windowHidden: hidden };
  } finally {
    if (hidden === true) await setApplicationVisible(true);
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * The page asks for a hidden-window capture by default; `?hide=0` keeps the window
 * visible, for capturing the application window itself.
 */
function shouldHideWindow(request) {
  try {
    return new URL(request.url, 'http://screenshot-tool.local').searchParams.get('hide') !== '0';
  } catch (error) {
    return true;
  }
}

/** Put the PNG on the macOS pasteboard so ⌘V pastes it as an image. */
async function copyImageToClipboard(file) {
  try {
    await execFileAsync('/usr/bin/osascript', [
      '-e', 'on run argv',
      '-e', 'set the clipboard to (read (POSIX file (item 1 of argv)) as «class PNGf»)',
      '-e', 'end run',
      file,
    ], { timeout: CLIPBOARD_TIMEOUT_MS });
    return true;
  } catch (error) {
    return false;
  }
}

/** Read width and height from a PNG IHDR chunk. */
function pngSize(bytes) {
  const isPng = bytes.length > 24
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!isPng) return { width: 0, height: 0 };
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * Refuse a request that another site's page originated. The desktop shell rewrites
 * `sec-fetch-site` to `same-origin` for the application document, and a foreign
 * page cannot clear that header. A request without the header (the local user, a
 * diagnostic curl) stays allowed.
 */
function isForeignRequest(request) {
  const site = request.headers['sec-fetch-site'];
  if (typeof site !== 'string' || site === '') return false;
  return site !== 'same-origin' && site !== 'none';
}

async function fileSize(file) {
  try {
    const info = await stat(file);
    return info.size;
  } catch (error) {
    return 0;
  }
}

async function discard(file) {
  try {
    await unlink(file);
  } catch (error) {
    /* The file may already be gone; nothing to clean up. */
  }
}

function execFileAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        if (typeof error === 'object' && error !== null) {
          error.stdout = stdout;
          error.stderr = stderr;
        }
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function sendJson(response, status, payload, headers = {}) {
  try {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    });
    response.end(JSON.stringify(payload));
  } catch (error) {
    /* The page navigated away or the socket closed; the capture still happened. */
  }
}

function stderrOf(error) {
  if (error === null || typeof error !== 'object') return '';
  const value = error.stderr;
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function messageOf(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
