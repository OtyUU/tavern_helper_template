<template>
  <div class="affection-bar">
    <div class="affection-header">
      <span class="label">💕 Affection Level</span>
      <span class="value">{{ data.kinako.affection }}/100</span>
      <span class="stage">[{{ stage_display }}]</span>
    </div>
    <div class="progress-container">
      <div class="progress-bar" :style="{ width: `${data.kinako.affection}%` }">
        <div class="progress-shine"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDataStore } from '../store';

const { data } = useDataStore();

const stage_display = computed(() => {
  const stage = data.value.kinako.$affection_stage;
  return stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
});
</script>

<style lang="scss" scoped>
.affection-bar {
  padding: 12px 16px;
  background: linear-gradient(to right, #fff5e6, #ffe5f0);
  border-bottom: 2px solid var(--c-kinako-pink);
}

.affection-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.label {
  font-weight: 700;
  font-size: 15px;
  color: var(--c-kinako-dark);
}

.value {
  font-weight: 600;
  color: var(--c-kinako-pink);
  font-size: 16px;
}

.stage {
  margin-left: auto;
  font-size: 13px;
  font-weight: 600;
  color: var(--c-kinako-teal);
  background: rgba(255, 255, 255, 0.7);
  padding: 2px 8px;
  border-radius: 12px;
}

.progress-container {
  height: 24px;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 12px;
  overflow: hidden;
  border: 2px solid var(--c-kinako-gold);
  position: relative;
}

.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--c-kinako-gold) 0%, var(--c-kinako-pink) 100%);
  transition: width 0.6s ease;
  position: relative;
  overflow: hidden;
}

.progress-shine {
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), transparent);
  animation: shine 2s infinite;
}

@keyframes shine {
  to {
    left: 200%;
  }
}
</style>
