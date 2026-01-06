import './样式.scss';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Sidebar from './Sidebar.vue';
import { createScriptIdDiv, destroyScriptIdDiv, deteleportStyle, teleportStyle } from '@/util/script';

const app = createApp(Sidebar).use(createPinia());

$(() => {
  // Register sidebar toggle button
  replaceScriptButtons([{ name: '侧边栏', visible: true }]);

  // Create and mount sidebar
  const $app = createScriptIdDiv().attr('id', 'sidebar-overlay-root');
  $('body').append($app);
  teleportStyle();
  app.mount($app[0]);

  // Toggle sidebar on button click
  eventOn(getButtonEvent('侧边栏'), () => {
    if (window.$sidebarToggle) {
      window.$sidebarToggle();
    }
  });
});

$(window).on('pagehide', () => {
  app.unmount();
  deteleportStyle();
  destroyScriptIdDiv();
});
