import { waitUntil } from 'async-wait-until';
import App from './App.vue';
import './global.css';

$(async () => {
  try {
    await waitGlobalInitialized('Mvu');
    await waitUntil(() => _.has(getVariables({ type: 'message' }), 'stat_data'));
  } catch (error) {
    console.warn('MVU not available or variables not found, continuing anyway:', error);
  }
  createApp(App).use(createPinia()).mount('#app');
});
