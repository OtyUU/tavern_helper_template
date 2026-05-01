import { createScriptIdDiv, teleportStyle } from '@util/script';
import App from './App.vue';
import SettingsPanel from './SettingsPanel.vue';
import { registerPlayerStatusMacro } from './status-macro';
import './renpy-player.scss';

$(() => {
  const pinia = createPinia();
  const playerApp = createApp(App).use(pinia);
  const settingsApp = createApp(SettingsPanel).use(pinia);
  const macroHandle = registerPlayerStatusMacro();

  const $playerHost = createScriptIdDiv().attr('id', 'th-renpy-player');
  const $settingsHost = createScriptIdDiv().appendTo('#extensions_settings2');

  const ensurePlayerHost = () => {
    const $chat = $('#chat');
    if ($chat.length > 0) {
      $playerHost.insertBefore($chat);
    }
  };

  ensurePlayerHost();

  playerApp.mount($playerHost[0]);
  settingsApp.mount($settingsHost[0]);

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
