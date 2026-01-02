<template>
  <div class="kinako-card">
    <WorldSection />
    <AffectionBar />
    <TabNav v-model="active_tab" :tabs="tabs" />
    <div v-if="active_tab" class="content-area">
      <div v-if="active_tab === 'kinako'" class="tab-pane active">
        <KinakoPanel />
      </div>
      <div v-else-if="active_tab === 'sato'" class="tab-pane active">
        <SatoPanel />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AffectionBar from './components/AffectionBar.vue';
import KinakoPanel from './components/KinakoPanel.vue';
import SatoPanel from './components/SatoPanel.vue';
import TabNav from './components/TabNav.vue';
import WorldSection from './components/WorldSection.vue';

const tabs = [
  { id: 'kinako', label: 'Kinako Info' },
  { id: 'sato', label: "Sato's Items" },
];

const active_tab = useLocalStorage<string | null>('kinako_status_bar:active_tab', null);
</script>

<style lang="scss" scoped>
.kinako-card {
  width: 100%;
  max-width: 720px;
  background: linear-gradient(135deg, var(--c-kinako-cream) 0%, #fffaf0 100%);
  border: 3px solid var(--c-kinako-dark);
  border-radius: 12px;
  box-shadow: 5px 5px 15px rgba(60, 73, 80, 0.2);
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: var(--c-kinako-dark);
  font-size: 14px;
  line-height: 1.5;
  margin: 12px auto;
  overflow: hidden;
}

.content-area {
  padding: 16px;
  min-height: 0;
}

.tab-pane {
  display: none;
  animation: fadeEffect 0.3s ease-in;
}

.tab-pane.active {
  display: block;
}

@keyframes fadeEffect {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
