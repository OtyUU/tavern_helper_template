import { deteleportStyle, teleportStyle } from '../util/script';
import jquerySource from 'jquery/dist/jquery.min.js?raw';
import lodashSource from 'lodash/lodash.min.js?raw';
import { z } from 'zod';

const SIDEBAR_ID = 'tavern-helper-external-html-sidebar';
const SIDEBAR_WIDTH = '500px';

// Zod schema for settings
const SettingsSchema = z.object({
  mode: z.enum(['url', 'paste']).default('url'),
  url: z.string().min(1).default('about:blank'),
  pasteContent: z.string().default(''),
});

type Settings = z.infer<typeof SettingsSchema>;

const HOST_BRIDGE_KEY = '__tavern_helper_external_html_sidebar_bridge__';

let sidebarVisible = false;
let currentBlobUrl: string | null = null;

function installHostBridge(): void {
  try {
    if (!window.parent) return;

    (window.parent as any)[HOST_BRIDGE_KEY] = {
      getGlobal: (name: string) => (globalThis as any)[name],
      getCurrentMessageId: () => {
        const getLastMessageId = (globalThis as any).getLastMessageId as undefined | (() => number);
        if (typeof getLastMessageId === 'function') return getLastMessageId();

        const chat = (globalThis as any).SillyTavern?.chat;
        if (Array.isArray(chat)) return Math.max(0, chat.length - 1);

        return 0;
      },
    };
  } catch {
    // ignore
  }
}

function escapeInlineScript(source: string): string {
  return source.replaceAll('</script', '<\\/script');
}

function setSidebarIframeSrc(src: string): void {
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }

  if (src.startsWith('blob:')) {
    currentBlobUrl = src;
  }

  $(`#${SIDEBAR_ID}-iframe`).attr('src', src);
}

function buildRuntimeWrappedHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  if (!doc.head) {
    const head = doc.createElement('head');
    doc.documentElement.insertBefore(head, doc.body);
  }

  if (!doc.head.querySelector('meta[charset]')) {
    const meta = doc.createElement('meta');
    meta.setAttribute('charset', 'UTF-8');
    doc.head.prepend(meta);
  }

  const runtimeShim = `
(() => {
  const BRIDGE_KEY = ${JSON.stringify(HOST_BRIDGE_KEY)};
  const bridge = (() => {
    try {
      return window.parent && window.parent[BRIDGE_KEY];
    } catch {
      return undefined;
    }
  })();

  const missing = name => () => {
    throw new Error(
      '[external-html-sidebar] Missing runtime global: ' +
        name +
        '. This page must be rendered inside SillyTavern with Tavern Helper + external-html-sidebar.',
    );
  };

  const getGlobal = name => (bridge && bridge.getGlobal ? bridge.getGlobal(name) : undefined);

  const bridgeFn = name => (...args) => {
    const fn = getGlobal(name);
    if (typeof fn !== 'function') return missing(name)();
    return fn(...args);
  };

  const syncGlobal = name => {
    try {
      const value = getGlobal(name);
      if (typeof value !== 'undefined' && typeof window[name] === 'undefined') {
        window[name] = value;
      }
    } catch {
      // ignore
    }
  };

  if (typeof window.waitGlobalInitialized !== 'function') {
    window.waitGlobalInitialized = async name => {
      await bridgeFn('waitGlobalInitialized')(name);
      syncGlobal(name);
    };
  }
  if (typeof window.getAllVariables !== 'function') window.getAllVariables = bridgeFn('getAllVariables');
  if (typeof window.getVariables !== 'function') window.getVariables = bridgeFn('getVariables');
  if (typeof window.replaceVariables !== 'function') window.replaceVariables = bridgeFn('replaceVariables');
  if (typeof window.triggerSlash !== 'function') window.triggerSlash = bridgeFn('triggerSlash');
  if (typeof window.eventOn !== 'function') window.eventOn = bridgeFn('eventOn');
  if (typeof window.getButtonEvent !== 'function') window.getButtonEvent = bridgeFn('getButtonEvent');
  if (typeof window.replaceScriptButtons !== 'function') window.replaceScriptButtons = bridgeFn('replaceScriptButtons');

  if (typeof window.errorCatched !== 'function') {
    window.errorCatched = fn => (...args) => {
      try {
        const result = fn(...args);
        if (result && typeof result.then === 'function') {
          return result.catch(err => {
            console.error(err);
            throw err;
          });
        }
        return result;
      } catch (err) {
        console.error(err);
        throw err;
      }
    };
  }

  syncGlobal('SillyTavern');
  syncGlobal('toastr');
  syncGlobal('Mvu');
  syncGlobal('tavern_events');
  syncGlobal('z');
  syncGlobal('gsap');
  syncGlobal('YAML');

  if (typeof window.getCurrentMessageId !== 'function') {
    window.getCurrentMessageId = () => {
      try {
        if (bridge && typeof bridge.getCurrentMessageId === 'function') {
          return bridge.getCurrentMessageId();
        }
      } catch {
        // ignore
      }

      try {
        const chat = window.SillyTavern && window.SillyTavern.chat;
        if (Array.isArray(chat)) return Math.max(0, chat.length - 1);
      } catch {
        // ignore
      }

      return 0;
    };
  }
})();
`;

  const scriptJquery = doc.createElement('script');
  scriptJquery.textContent = escapeInlineScript(jquerySource);

  const scriptLodash = doc.createElement('script');
  scriptLodash.textContent = escapeInlineScript(lodashSource);

  const scriptShim = doc.createElement('script');
  scriptShim.textContent = escapeInlineScript(runtimeShim);

  doc.head.prepend(scriptJquery, scriptLodash, scriptShim);

  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}

function getSettings(): Settings {
  try {
    const vars = getVariables({ type: 'script' });
    return SettingsSchema.parse(vars);
  } catch (e) {
    return SettingsSchema.parse({});
  }
}

function saveSettings(settings: Settings) {
  replaceVariables(settings, { type: 'script' });
}

function injectCSS(): void {
  const css = `
    #${SIDEBAR_ID} {
      position: fixed;
      top: 0;
      right: 0;
      width: ${SIDEBAR_WIDTH};
      height: 100vh;
      background: rgba(29, 33, 40, 0.95);
      backdrop-filter: blur(5px);
      border-left: 0.5px solid rgba(0, 0, 0, 0.5);
      border-top-left-radius: 12px;
      border-bottom-left-radius: 12px;
      z-index: 999999;
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      transform: translateX(100%);
      display: flex;
      flex-direction: column;
      color: rgba(207, 207, 197, 1);
      box-shadow: -2px 0 10px rgba(0, 0, 0, 0.5);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
    }

    #${SIDEBAR_ID}.visible {
      transform: translateX(0);
    }

    #${SIDEBAR_ID} .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0 20px;
      height: 50px;
      background: rgba(29, 33, 40, 0.98);
      border-bottom: 0.5px solid rgba(0, 0, 0, 0.8);
      border-top-left-radius: 12px;
      flex-shrink: 0;
    }

    #${SIDEBAR_ID} .header h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 500;
    }

    #${SIDEBAR_ID} .close-btn {
      background: rgba(29, 33, 40, 0.6);
      border: 0.5px solid rgba(0, 0, 0, 0.8);
      color: rgba(207, 207, 197, 0.9);
      cursor: pointer;
      padding: 5px 12px;
      border-radius: 8px;
      font-size: 20px;
      transition: all 0.2s ease;
      line-height: 1;
    }

    #${SIDEBAR_ID} .close-btn:hover {
      background: rgba(40, 45, 52, 0.8);
      color: #fff;
    }

    #${SIDEBAR_ID} .content {
      flex: 1;
      overflow: hidden;
      position: relative;
    }

    #${SIDEBAR_ID} iframe {
      width: 100%;
      height: 100%;
      border: none;
      background: transparent;
    }

    #${SIDEBAR_ID} .footer {
      padding: 10px 15px;
      background: rgba(29, 33, 40, 0.98);
      border-top: 0.5px solid rgba(0, 0, 0, 0.8);
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }

    #${SIDEBAR_ID} .url-input {
      flex: 1;
      background: rgba(0, 0, 0, 0.3);
      border: 0.5px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      color: #fff;
      padding: 6px 10px;
      font-size: 12px;
      outline: none;
    }

    #${SIDEBAR_ID} .load-btn {
      background: #4a5568;
      border: none;
      border-radius: 6px;
      color: #fff;
      padding: 6px 12px;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.2s;
    }

    #${SIDEBAR_ID} .load-btn:hover {
      background: #2d3748;
    }

    #${SIDEBAR_ID} .mode-toggle {
      display: flex;
      background: rgba(0, 0, 0, 0.3);
      border-radius: 6px;
      padding: 2px;
      margin-bottom: 8px;
    }

    #${SIDEBAR_ID} .mode-option {
      flex: 1;
      background: transparent;
      border: none;
      color: #aaa;
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s;
    }

    #${SIDEBAR_ID} .mode-option.active {
      background: #4a5568;
      color: #fff;
    }

    #${SIDEBAR_ID} .mode-content {
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 1;
    }

    #${SIDEBAR_ID} .paste-container {
      display: none;
      flex-direction: column;
      gap: 8px;
    }

    #${SIDEBAR_ID} .paste-container.active {
      display: flex;
    }

    #${SIDEBAR_ID} .url-container {
      display: none;
      gap: 8px;
    }

    #${SIDEBAR_ID} .url-container.active {
      display: flex;
    }

    #${SIDEBAR_ID} .paste-textarea {
      flex: 1;
      background: rgba(0, 0, 0, 0.3);
      border: 0.5px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      color: #fff;
      padding: 8px;
      font-size: 12px;
      font-family: 'Courier New', monospace;
      resize: vertical;
      min-height: 60px;
      outline: none;
    }

    #${SIDEBAR_ID} .paste-textarea:focus {
      border-color: #4a5568;
    }

    #${SIDEBAR_ID} .render-btn {
      background: #4a5568;
      border: none;
      border-radius: 6px;
      color: #fff;
      padding: 6px 12px;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.2s;
    }

    #${SIDEBAR_ID} .render-btn:hover {
      background: #2d3748;
    }
  `;
  $('<style>').text(css).appendTo('head');
  teleportStyle();
}

function injectHTML(): void {
  if ($(`#${SIDEBAR_ID}`).length > 0) return;

  const settings = getSettings();
  const mode = settings.mode || 'url';
  const html = `
    <div id="${SIDEBAR_ID}">
      <div class="header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 18px;">🌐</span>
          <h3>External Interface</h3>
        </div>
        <button class="close-btn" id="${SIDEBAR_ID}-close" title="Close">×</button>
      </div>
      <div class="content">
        <iframe id="${SIDEBAR_ID}-iframe" src="${settings.url}"></iframe>
      </div>
      <div class="footer">
        <div class="mode-toggle">
          <button class="mode-option ${mode === 'url' ? 'active' : ''}" data-mode="url">URL</button>
          <button class="mode-option ${mode === 'paste' ? 'active' : ''}" data-mode="paste">Paste Code</button>
        </div>
        <div class="mode-content">
          <div class="url-container ${mode === 'url' ? 'active' : ''}">
            <input type="text" class="url-input" id="${SIDEBAR_ID}-url-input" value="${settings.url === 'about:blank' ? '' : settings.url}" placeholder="Enter HTML URL (e.g. ./panel/index.html)...">
            <button class="load-btn" id="${SIDEBAR_ID}-load-btn">Load</button>
          </div>
          <div class="paste-container ${mode === 'paste' ? 'active' : ''}">
            <textarea class="paste-textarea" id="${SIDEBAR_ID}-paste-textarea" placeholder="Paste your HTML/CSS/JS code here...">${settings.pasteContent}</textarea>
            <button class="render-btn" id="${SIDEBAR_ID}-render-btn">Render</button>
          </div>
        </div>
      </div>
    </div>
  `;
  $('body').append(html);

  $(`#${SIDEBAR_ID}-close`).on('click', () => toggleSidebar(false));

  // Mode toggle functionality
  $(`.mode-option`).on('click', function () {
    const selectedMode = $(this).data('mode');
    switchMode(selectedMode);
  });

  // URL mode functionality
  $(`#${SIDEBAR_ID}-load-btn`).on('click', () => {
    const url = ($(`#${SIDEBAR_ID}-url-input`).val() as string).trim();
    if (url) {
      updateUrl(url);
    }
  });

  $(`#${SIDEBAR_ID}-url-input`).on('keypress', e => {
    if (e.which === 13) {
      const url = ($(`#${SIDEBAR_ID}-url-input`).val() as string).trim();
      if (url) updateUrl(url);
    }
  });

  // Paste mode functionality
  $(`#${SIDEBAR_ID}-render-btn`).on('click', () => {
    const code = $(`#${SIDEBAR_ID}-paste-textarea`).val() as string;
    if (code.trim()) {
      renderPastedCode(code);
    }
  });

  $(`#${SIDEBAR_ID}-paste-textarea`).on('input', () => {
    const code = $(`#${SIDEBAR_ID}-paste-textarea`).val() as string;
    saveSettings({ ...getSettings(), pasteContent: code });
  });

  // Initialize based on current mode
  if (mode === 'paste' && settings.pasteContent) {
    renderPastedCode(settings.pasteContent);
  }
}

function updateUrl(url: string) {
  try {
    // Add protocol if missing and it looks like a domain
    if (
      !url.startsWith('http://') &&
      !url.startsWith('https://') &&
      !url.startsWith('./') &&
      !url.startsWith('/') &&
      url !== 'about:blank'
    ) {
      if (url.includes('.') && !url.includes(' ')) {
        url = 'https://' + url;
      }
    }

    SettingsSchema.parse({ url });
    setSidebarIframeSrc(url);
    saveSettings({ ...getSettings(), url });
    toastr.success('URL updated and loaded');
  } catch {
    toastr.error('Invalid URL format');
  }
}

function switchMode(newMode: 'url' | 'paste') {
  const settings = getSettings();
  saveSettings({ ...settings, mode: newMode });

  // Update UI
  $('.mode-option').removeClass('active');
  $(`.mode-option[data-mode="${newMode}"]`).addClass('active');

  $('.url-container').toggleClass('active', newMode === 'url');
  $('.paste-container').toggleClass('active', newMode === 'paste');

  toastr.info(`Switched to ${newMode} mode`);
}

function renderPastedCode(code: string) {
  try {
    const fullHtml = buildRuntimeWrappedHtml(code);

    const blob = new Blob([fullHtml], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);

    setSidebarIframeSrc(blobUrl);

    saveSettings({ ...getSettings(), pasteContent: code });

    toastr.success('Code rendered (Tavern Helper runtime shims enabled)');
  } catch (error) {
    console.error('Failed to render pasted code:', error);
    toastr.error('Failed to render code: ' + (error instanceof Error ? error.message : String(error)));
  }
}

function toggleSidebar(show?: boolean) {
  sidebarVisible = typeof show === 'boolean' ? show : !sidebarVisible;
  $(`#${SIDEBAR_ID}`).toggleClass('visible', sidebarVisible);
}

// Initialization
$(() => {
  installHostBridge();
  injectCSS();
  injectHTML();

  const buttonName = '🌐 External Interface';

  // Register button in Tavern Helper
  if (typeof replaceScriptButtons === 'function') {
    replaceScriptButtons([{ name: buttonName, visible: true }]);
  }

  // Listen for button click
  if (typeof getButtonEvent === 'function') {
    const eventName = getButtonEvent(buttonName);
    eventOn(eventName, () => toggleSidebar());
  }

  // Handle global escape to close
  $(document).on('keydown', e => {
    if (e.key === 'Escape' && sidebarVisible) {
      toggleSidebar(false);
    }
  });
});

// Cleanup
$(window).on('pagehide', () => {
  $(`#${SIDEBAR_ID}`).remove();
  deteleportStyle();

  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }

  try {
    delete (window.parent as any)[HOST_BRIDGE_KEY];
  } catch {
    // ignore
  }
});
