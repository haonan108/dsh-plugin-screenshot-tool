window.__ModuleLoader__.load({
  id: 'dsh-plugin-screenshot-tool',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-plugin-screenshot-tool';
    const API_CAPTURE = '/screenshot-tool/api/capture';
    const API_HELLO = '/screenshot-tool/api/hello';
    const API_PERMISSION_SETTINGS = '/screenshot-tool/api/permission-settings';
    const PREVIEW_DISMISS_MS = 8000;
    /* Slightly longer than the Host's own capture timeout, so only a dead Host aborts. */
    const CAPTURE_DEADLINE_MS = 6 * 60 * 1000;
    const MODE_STORAGE_KEY = 'dsh.screenshot-tool.mode.v1';
    const MENU_WIDTH = 188;
    const MENU_HEIGHT = 82;
    const MODE_HIDE = 'hide';
    const MODE_KEEP = 'keep';

    /** Visible text; the Client locale service owns the active language. */
    const DICT = {
      zh: {
        'action.capture': '截图',
        'action.captureHint': '屏幕截图：点按直接截图，用右侧箭头选择是否隐藏窗口',
        'action.modeHint': '选择截图时是否隐藏窗口',
        'action.recapture': '重新截图',
        'action.close': '关闭',
        'action.openSettings': '打开屏幕录制设置',
        'menu.hide': '隐藏窗口截图',
        'menu.keep': '不隐藏窗口截图',
        'state.attached': '已放入输入框，按 Enter 发送',
        'state.copied': '已复制到剪贴板，在输入框按 ⌘V 粘贴',
        'state.notCopied': '已截取，但复制到剪贴板失败',
        'state.size': '{width} × {height}',
        'state.windowHint': '窗口未能自动隐藏：可在 系统设置 → 隐私与安全性 → 自动化 中允许 DeepSeek Harness 控制 System Events。',
        'preview.alt': '刚截取的屏幕区域',
        'error.unsupported': '当前系统不支持原生截图',
        'error.permission': '屏幕录制权限未开启：在系统设置 → 隐私与安全性 → 屏幕录制中允许 DeepSeek Harness，然后退出并重新打开应用。',
        'error.busy': '已有一次截图正在进行',
        'error.timeout': '截图超时，请重试',
        'error.network': '无法连接截图服务，请确认插件已启用',
        'error.method': '截图请求方式不正确',
        'error.failed': '截图失败，请重试',
      },
      en: {
        'action.capture': 'Screenshot',
        'action.captureHint': 'Screen capture: click to capture, use the caret to choose whether the window hides',
        'action.modeHint': 'Choose whether the window hides while capturing',
        'action.recapture': 'Capture again',
        'action.close': 'Close',
        'action.openSettings': 'Open Screen Recording settings',
        'menu.hide': 'Capture with the window hidden',
        'menu.keep': 'Capture with the window visible',
        'state.attached': 'Added to the composer — press Enter to send',
        'state.copied': 'Copied — press ⌘V in the composer to paste',
        'state.notCopied': 'Captured, but copying to the clipboard failed',
        'state.size': '{width} × {height}',
        'state.windowHint': 'The window could not hide: allow DeepSeek Harness to control System Events in System Settings → Privacy & Security → Automation.',
        'preview.alt': 'The screen region just captured',
        'error.unsupported': 'Native capture is not supported on this platform',
        'error.permission': 'Screen Recording is off: allow DeepSeek Harness in System Settings → Privacy & Security → Screen Recording, then quit and reopen the app.',
        'error.busy': 'A capture is already in progress',
        'error.timeout': 'The capture timed out — try again',
        'error.network': 'Cannot reach the capture service; check that the plugin is enabled',
        'error.method': 'The capture request method is not allowed',
        'error.failed': 'The capture failed — try again',
      },
    };

    const CSS = [
      '.dsh-shot-split{display:inline-flex;align-items:center;gap:0;position:relative}',
      '.dsh-shot-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:28px;',
      'padding:0;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);',
      'cursor:pointer;transition:background .12s ease,color .12s ease}',
      '.dsh-shot-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dsh-shot-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dsh-shot-btn:disabled{cursor:progress}',
      '.dsh-shot-btn.is-busy{animation:dsh-shot-pulse 1.1s ease-in-out infinite}',
      '@keyframes dsh-shot-pulse{0%,100%{opacity:1}50%{opacity:.45}}',
      '.dsh-shot-caret{display:inline-flex;align-items:center;justify-content:center;width:13px;height:28px;',
      'padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.dsh-shot-caret:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dsh-shot-caret:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dsh-shot-caret.is-open{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dsh-shot-backdrop{position:fixed;inset:0;z-index:2147482998;background:transparent}',
      '.dsh-shot-menu{position:fixed;z-index:2147482999;width:' + MENU_WIDTH + 'px;padding:5px;box-sizing:border-box;',
      'border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);',
      'box-shadow:0 10px 28px var(--dsw-elevation-prominent, rgba(0,0,0,.26));display:flex;flex-direction:column;gap:2px;',
      'font-size:12px;line-height:1.4;font-family:inherit}',
      '.dsh-shot-menu-item{display:flex;align-items:center;gap:6px;width:100%;padding:6px 8px;border:0;border-radius:7px;',
      'background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer}',
      '.dsh-shot-menu-item:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-shot-menu-item.is-checked{color:var(--dsw-alias-brand-primary)}',
      '.dsh-shot-menu-check{width:11px;flex:none;font-size:11px;line-height:1;text-align:center}',
      '.dsh-shot-card{position:fixed;right:24px;bottom:24px;z-index:2147483000;width:280px;padding:10px;',
      'box-sizing:border-box;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);',
      'background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);',
      'box-shadow:0 12px 32px var(--dsw-elevation-prominent, rgba(0,0,0,.28));font-size:12px;line-height:1.5;',
      'font-family:inherit;display:flex;flex-direction:column;gap:8px}',
      '.dsh-shot-card *{box-sizing:border-box}',
      '.dsh-shot-img{display:block;width:100%;max-height:168px;object-fit:contain;border-radius:8px;',
      'border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-shot-status{display:flex;align-items:flex-start;gap:6px}',
      '.dsh-shot-dot{flex:none;width:6px;height:6px;margin-top:5px;border-radius:999px;background:var(--dsw-alias-state-success-primary)}',
      '.dsh-shot-text{flex:1;min-width:0}',
      '.dsh-shot-size{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dsh-shot-error{color:var(--dsw-alias-state-error-primary)}',
      '.dsh-shot-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px}',
      '.dsh-shot-action{padding:3px 9px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);',
      'background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}',
      '.dsh-shot-action:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dsh-shot-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dsh-shot-action.is-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
    ].join('');

    function loadMode() {
      try {
        return window.localStorage.getItem(MODE_STORAGE_KEY) === MODE_KEEP ? MODE_KEEP : MODE_HIDE;
      } catch (error) {
        return MODE_HIDE;
      }
    }

    function saveMode(mode) {
      try {
        window.localStorage.setItem(MODE_STORAGE_KEY, mode);
      } catch (error) {
        /* The choice simply will not survive a reload. */
      }
    }

    /** Shared state: the toolbar split button, the dropdown and the result card read it. */
    const state = { status: 'idle', shot: null, error: null, menu: null, mode: loadMode() };
    const listeners = new Set();

    function patch(next) {
      Object.assign(state, next);
      for (const listener of Array.from(listeners)) {
        try {
          listener();
        } catch (error) {
          /* A stale component must not break the others. */
        }
      }
    }

    function subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }

    function translate(locale, key, params) {
      if (locale && typeof locale.bind === 'function') {
        try {
          return locale.bind(NS)(key, params);
        } catch (error) {
          /* Fall through to the bundled default. */
        }
      }
      const text = DICT.zh[key] !== undefined ? DICT.zh[key] : key;
      if (!params) return text;
      return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
    }

    let inFlight = false;

    async function beginCapture(options) {
      if (inFlight) return;
      const keepWindow = typeof options === 'object' && options !== null && options.keepWindow === true;
      inFlight = true;
      patch({ status: 'capturing', shot: null, error: null, menu: null });
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const deadline = controller === null
        ? null
        : window.setTimeout(() => controller.abort(), CAPTURE_DEADLINE_MS);
      try {
        const response = await fetch(API_CAPTURE + (keepWindow ? '?hide=0' : ''), {
          method: 'POST',
          signal: controller === null ? undefined : controller.signal,
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const result = await response.json();
        if (result && result.ok === true && typeof result.image === 'string') {
          if (result.permission === 'denied') {
            /* The pixels are the wallpaper layer only; ask for the grant instead. */
            patch({ status: 'error', shot: null, error: 'permission' });
          } else {
            const attached = pasteIntoComposer(result);
            patch({ status: 'done', shot: { ...result, attached }, error: null });
          }
        } else if (result && result.reason === 'cancelled') {
          patch({ status: 'idle', shot: null, error: null });
        } else {
          patch({ status: 'error', shot: null, error: (result && result.reason) || 'capture-failed' });
        }
      } catch (error) {
        patch({ status: 'error', shot: null, error: 'network' });
      } finally {
        if (deadline !== null) window.clearTimeout(deadline);
        inFlight = false;
      }
    }

    function closePreview() {
      patch({ status: 'idle', shot: null, error: null });
    }

    function openPermissionSettings() {
      fetch(API_PERMISSION_SETTINGS, { method: 'POST' }).catch(() => {});
    }

    function dataUrlToFile(dataUrl, name) {
      const comma = dataUrl.indexOf(',');
      if (comma < 0) return null;
      const header = dataUrl.slice(5, comma);
      const mime = header.split(';')[0] || 'image/png';
      const binary = window.atob(dataUrl.slice(comma + 1));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return new File([bytes], name, { type: mime });
    }

    function findComposerEditor() {
      const active = document.activeElement;
      if (active !== null
        && typeof active.getAttribute === 'function'
        && active.getAttribute('data-lexical-editor') === 'true') {
        return active;
      }
      const editors = document.querySelectorAll('[data-lexical-editor="true"]');
      if (editors.length > 0) return editors[editors.length - 1];
      const editable = document.querySelectorAll('[contenteditable="true"]');
      if (editable.length > 0) return editable[editable.length - 1];
      return null;
    }

    /**
     * A plugin cannot synthesize a trusted paste, but the composer's paste command
     * only reads `event.clipboardData.items`, and a constructed ClipboardEvent can
     * carry a DataTransfer holding the captured PNG. The composer then uploads it as
     * a draft attachment, so the screenshot is ready to send without ⌘V.
     */
    function pasteIntoComposer(shot) {
      try {
        const editor = findComposerEditor();
        if (editor === null) return false;
        const file = dataUrlToFile(shot.image, 'screenshot-' + Date.now() + '.png');
        if (file === null) return false;
        const transfer = new DataTransfer();
        transfer.items.add(file);
        const event = new ClipboardEvent('paste', {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        });
        if (event.clipboardData === null) {
          try {
            Object.defineProperty(event, 'clipboardData', { value: transfer });
          } catch (error) {
            /* Fall through: the composer will see no files and the card says ⌘V. */
          }
        }
        try {
          editor.focus();
        } catch (error) {
          /* Focus is a courtesy; the paste event does not need it. */
        }
        editor.dispatchEvent(event);
        return event.defaultPrevented === true;
      } catch (error) {
        return false;
      }
    }

    function useSharedState() {
      const [, bump] = React.useState(0);
      React.useEffect(() => subscribe(() => bump((value) => value + 1)), []);
      return state;
    }

    function useLocale(locale) {
      const [, bump] = React.useState(0);
      React.useEffect(() => {
        if (!locale || typeof locale.subscribe !== 'function') return undefined;
        return locale.subscribe(() => bump((value) => value + 1));
      }, []);
    }

    function errorText(locale, reason) {
      switch (reason) {
        case 'unsupported-platform': return translate(locale, 'error.unsupported');
        case 'permission': return translate(locale, 'error.permission');
        case 'busy': return translate(locale, 'error.busy');
        case 'timeout': return translate(locale, 'error.timeout');
        case 'network': return translate(locale, 'error.network');
        case 'method': return translate(locale, 'error.method');
        default: return translate(locale, 'error.failed');
      }
    }

    /** Keep the composer editor focused: a plain click would move focus to this button. */
    function keepFocus(event) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
    }

    /** WeChat-style scissors: handles at the bottom, the open blades pointing up. */
    function scissorsIcon() {
      return h(
        'svg',
        { width: 15, height: 15, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: 'false' },
        h(
          'g',
          {
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.4,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          h('circle', { cx: 5.3, cy: 12.2, r: 1.7 }),
          h('circle', { cx: 10.7, cy: 12.2, r: 1.7 }),
          h('path', { d: 'M6.4 10.8 10.7 3.1' }),
          h('path', { d: 'M9.6 10.8 5.3 3.1' }),
        ),
      );
    }

    function caretIcon(open) {
      return h(
        'svg',
        { width: 8, height: 8, viewBox: '0 0 8 8', 'aria-hidden': true, focusable: 'false' },
        h('path', {
          d: open ? 'M1.2 5.2 4 2.4l2.8 2.8' : 'M1.2 2.8 4 5.6l2.8-2.8',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    /** The toolbar control: a split button — capture, and a caret for the capture mode. */
    function createButton(locale) {
      return function ScreenshotButton() {
        const view = useSharedState();
        useLocale(locale);
        const busy = view.status === 'capturing';
        const menuOpen = view.menu !== null;
        const label = translate(locale, 'action.capture');
        let wrapper = null;

        function toggleMenu(event) {
          if (typeof event.stopPropagation === 'function') event.stopPropagation();
          if (menuOpen) {
            patch({ menu: null });
            return;
          }
          const rect = wrapper === null ? null : wrapper.getBoundingClientRect();
          if (rect === null) return;
          const left = Math.min(
            Math.max(8, rect.left),
            Math.max(8, window.innerWidth - MENU_WIDTH - 8),
          );
          patch({
            menu: {
              top: Math.max(8, rect.top - MENU_HEIGHT - 8),
              left,
            },
          });
        }

        return h(
          'div',
          {
            className: 'dsh-shot-split',
            ref: (node) => {
              wrapper = node;
            },
          },
          h('button', {
            type: 'button',
            className: 'dsh-shot-btn' + (busy ? ' is-busy' : ''),
            title: translate(locale, 'action.captureHint'),
            'aria-label': label,
            'aria-busy': busy,
            disabled: busy,
            onMouseDown: keepFocus,
            onClick: () => beginCapture({ keepWindow: view.mode === MODE_KEEP }),
          }, scissorsIcon()),
          h('button', {
            type: 'button',
            className: 'dsh-shot-caret' + (menuOpen ? ' is-open' : ''),
            title: translate(locale, 'action.modeHint'),
            'aria-label': translate(locale, 'action.modeHint'),
            'aria-haspopup': 'menu',
            'aria-expanded': menuOpen,
            disabled: busy,
            onMouseDown: keepFocus,
            onClick: toggleMenu,
          }, caretIcon(menuOpen)),
        );
      };
    }

    /**
     * The frame-wide layer: the capture-mode dropdown and the result card. It stays
     * mounted as an empty live region so state changes are announced.
     */
    function createLayer(locale) {
      return function ScreenshotLayer() {
        const view = useSharedState();
        useLocale(locale);
        const open = view.status === 'done' || view.status === 'error';
        const menu = view.menu;
        const needsPermission = view.status === 'error' && view.error === 'permission';

        React.useEffect(() => {
          if (!open && menu === null) return undefined;
          function onKeyDown(event) {
            if (event.key !== 'Escape') return;
            if (state.menu !== null) patch({ menu: null });
            else closePreview();
          }
          window.addEventListener('keydown', onKeyDown);
          return () => window.removeEventListener('keydown', onKeyDown);
        }, [open, menu]);

        React.useEffect(() => {
          if (view.status !== 'done') return undefined;
          const handle = window.setTimeout(() => closePreview(), PREVIEW_DISMISS_MS);
          return () => window.clearTimeout(handle);
        }, [view.status, view.shot]);

        const children = [];
        if (open) {
          if (view.status === 'done' && view.shot) {
            children.push(h('img', {
              key: 'image',
              className: 'dsh-shot-img',
              src: view.shot.image,
              alt: translate(locale, 'preview.alt'),
            }));
            children.push(h(
              'div',
              { key: 'status', className: 'dsh-shot-status' },
              h('span', { className: 'dsh-shot-dot', 'aria-hidden': true }),
              h('span', { className: 'dsh-shot-text' }, translate(
                locale,
                view.shot.attached === true
                  ? 'state.attached'
                  : (view.shot.copied === false ? 'state.notCopied' : 'state.copied'),
              )),
            ));
            children.push(h('div', { key: 'size', className: 'dsh-shot-size' }, translate(locale, 'state.size', {
              width: view.shot.width || '?',
              height: view.shot.height || '?',
            })));
            if (view.shot.windowHidden === false) {
              children.push(h('div', { key: 'window', className: 'dsh-shot-size' },
                translate(locale, 'state.windowHint')));
            }
          } else {
            children.push(h(
              'div',
              { key: 'error', className: 'dsh-shot-error' },
              errorText(locale, view.error),
            ));
          }

          const actions = [];
          if (needsPermission) {
            actions.push(h('button', {
              key: 'settings',
              type: 'button',
              className: 'dsh-shot-action is-primary',
              onMouseDown: keepFocus,
              onClick: openPermissionSettings,
            }, translate(locale, 'action.openSettings')));
          }
          actions.push(h('button', {
            key: 'recapture',
            type: 'button',
            className: 'dsh-shot-action' + (needsPermission ? '' : ' is-primary'),
            onMouseDown: keepFocus,
            onClick: () => beginCapture({ keepWindow: state.mode === MODE_KEEP }),
          }, translate(locale, 'action.recapture')));
          actions.push(h('button', {
            key: 'close',
            type: 'button',
            className: 'dsh-shot-action',
            onClick: closePreview,
          }, translate(locale, 'action.close')));

          children.push(h('div', { key: 'actions', className: 'dsh-shot-actions' }, actions));
        }

        const layers = [];
        if (menu !== null) {
          layers.push(h('div', {
            key: 'backdrop',
            className: 'dsh-shot-backdrop',
            onClick: () => patch({ menu: null }),
            onContextMenu: () => patch({ menu: null }),
          }));
          const items = [
            { mode: MODE_HIDE, key: 'menu.hide' },
            { mode: MODE_KEEP, key: 'menu.keep' },
          ];
          layers.push(h(
            'div',
            {
              key: 'menu',
              className: 'dsh-shot-menu',
              role: 'menu',
              style: { top: menu.top + 'px', left: menu.left + 'px' },
              onMouseDown: keepFocus,
            },
            items.map((item) => h(
              'button',
              {
                key: item.mode,
                type: 'button',
                role: 'menuitemradio',
                'aria-checked': view.mode === item.mode,
                className: 'dsh-shot-menu-item' + (view.mode === item.mode ? ' is-checked' : ''),
                onClick: () => {
                  saveMode(item.mode);
                  patch({ mode: item.mode, menu: null });
                  beginCapture({ keepWindow: item.mode === MODE_KEEP });
                },
              },
              h('span', { className: 'dsh-shot-menu-check', 'aria-hidden': true },
                view.mode === item.mode ? '✓' : ''),
              h('span', null, translate(locale, item.key)),
            )),
          ));
        }

        layers.push(h('div', {
          key: 'card',
          className: open ? 'dsh-shot-card' : undefined,
          role: 'status',
          'aria-live': 'polite',
        }, children));

        return h(
          React.Fragment,
          null,
          h('style', { key: 'dsh-shot-styles' }, CSS),
          layers,
        );
      };
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined;

        if (locale && typeof locale.register === 'function') {
          ctx.effect(() => locale.register(NS, DICT), 'screenshot-tool: dictionaries');
        }

        ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
          { name: 'conversation.input.left', id: 'screenshot-tool', order: 12 },
          createButton(locale),
        ));

        ctx.slots.inject('shell.overlay', () => ctx.slots.register(
          { name: 'shell.overlay', id: 'screenshot-tool-preview', order: 60 },
          createLayer(locale),
        ));

        /* Runs last: a recorded handshake means the button and the layer are registered too. */
        ctx.effect(() => {
          const controller = typeof AbortController === 'function' ? new AbortController() : null;
          fetch(API_HELLO, { method: 'POST', signal: controller === null ? undefined : controller.signal })
            .catch(() => {});
          return () => {
            if (controller !== null) controller.abort();
          };
        }, 'screenshot-tool: host handshake');
      },
    };
  },
});
