import { createScriptIdDiv, teleportStyle } from '@util/script';
import App from './App.vue';
import './renpy-player.scss';
import SettingsPanel from './SettingsPanel.vue';
import { registerPlayerStatusMacro } from './status-macro';

$(() => {
  const pinia = createPinia();
  const playerApp = createApp(App).use(pinia);
  const settingsApp = createApp(SettingsPanel).use(pinia);
  const macroHandle = registerPlayerStatusMacro();

  const $playerHost = createScriptIdDiv().attr('id', 'th-renpy-player');
  const $settingsHost = createScriptIdDiv().appendTo('#extensions_settings2');

  // jQuery уже работает с host page DOM — используем его для поиска PTMT-панелей
  const isInsidePtmtPanel = () =>
    $playerHost.closest('.ptmt-panel-content').length > 0;

  const ensurePlayerHost = () => {
    // Если PTMT управляет элементом — не трогаем его позицию
    if (isInsidePtmtPanel()) return;
    const $chat = $('#chat');
    if ($chat.length > 0) {
      $playerHost.insertBefore($chat);
    }
  };

  ensurePlayerHost();
  playerApp.mount($playerHost[0]);
  settingsApp.mount($settingsHost[0]);

  // PTMT живёт на host page — нужен window.parent, а не window
  const getPtmtApi = () => (window.parent as any).ptmtTabs ?? null;

  const tryRegisterPtmtTab = (): boolean => {
    const api = getPtmtApi();
    if (!api) return false;

    // Проверяем через jQuery (host page DOM), не через document iframe
    if ($('.ptmt-panel[data-source-id="th-renpy-player"]').length > 0) return true;

    api.createTabFromContent('th-renpy-player', {
      title: "Ren'Py Player",
      icon: 'fa-film',
      makeActive: false,
    });

    console.log('[renpy-player] Registered PTMT tab');
    return true;
  };

  // Пробуем сразу, затем несколько раз с задержкой —
  // PTMT инициализируется позже через eventSource.on(APP_READY)
  if (!tryRegisterPtmtTab()) {
    [500, 1500, 4000].forEach(delay =>
      setTimeout(() => {
        if (!isInsidePtmtPanel()) tryRegisterPtmtTab();
      }, delay)
    );
  }

  const { destroy } = teleportStyle();
  const stopList = [
    eventOn(tavern_events.CHAT_CHANGED, ensurePlayerHost).stop,
    eventOn(tavern_events.MORE_MESSAGES_LOADED, ensurePlayerHost).stop,
  ];

  $(window).on('pagehide', () => {
    stopList.forEach(stop => stop());
    macroHandle.unregister();
    playerApp.unmount();
    settingsApp.unmount();
    $playerHost.remove();
    $settingsHost.remove();
    destroy();
  });
});