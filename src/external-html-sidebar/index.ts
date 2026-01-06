import { deteleportStyle, teleportStyle } from '../util/script';

const SIDEBAR_ID = 'tavern-helper-external-html-sidebar';
const SIDEBAR_WIDTH = '500px';

// Zod schema for settings
const SettingsSchema = z.object({
  url: z.string().url().or(z.literal('about:blank')).default('about:blank'),
});

type Settings = z.infer<typeof SettingsSchema>;

let sidebarVisible = false;

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
  `;
  $('<style>').text(css).appendTo('head');
  teleportStyle();
}

function injectHTML(): void {
  if ($(`#${SIDEBAR_ID}`).length > 0) return;

  const settings = getSettings();
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
        <input type="text" class="url-input" id="${SIDEBAR_ID}-url-input" value="${settings.url === 'about:blank' ? '' : settings.url}" placeholder="Enter HTML URL...">
        <button class="load-btn" id="${SIDEBAR_ID}-load-btn">Load</button>
      </div>
    </div>
  `;
  $('body').append(html);

  $(`#${SIDEBAR_ID}-close`).on('click', () => toggleSidebar(false));
  $(`#${SIDEBAR_ID}-load-btn`).on('click', () => {
    const url = ($(`#${SIDEBAR_ID}-url-input`).val() as string).trim();
    if (url) {
      updateUrl(url);
    }
  });

  // Handle Enter key in input
  $(`#${SIDEBAR_ID}-url-input`).on('keypress', e => {
    if (e.which === 13) {
      const url = ($(`#${SIDEBAR_ID}-url-input`).val() as string).trim();
      if (url) updateUrl(url);
    }
  });
}

function updateUrl(url: string) {
  try {
    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://') && url !== 'about:blank') {
      url = 'https://' + url;
    }
    SettingsSchema.parse({ url });
    $(`#${SIDEBAR_ID}-iframe`).attr('src', url);
    saveSettings({ url });
    toastr.success('URL updated and loaded');
  } catch (e) {
    toastr.error('Invalid URL format');
  }
}

function toggleSidebar(show?: boolean) {
  sidebarVisible = typeof show === 'boolean' ? show : !sidebarVisible;
  $(`#${SIDEBAR_ID}`).toggleClass('visible', sidebarVisible);
}

// Initialization
$(() => {
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
});
