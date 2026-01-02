<template>
  <div class="kinako-status-bar">
    <div class="status-item">
      <span class="label">Affection:</span>
      <span class="value">{{ data.affection }}</span>
    </div>
    <div class="status-item">
      <span class="label">Mood:</span>
      <span class="value">{{ data.mood }}</span>
    </div>
    <div class="status-item">
      <span class="label">Energy:</span>
      <span class="value">{{ data.energy }}</span>
    </div>
    <div class="status-item">
      <span class="label">Trust:</span>
      <span class="value">{{ data.trust }}</span>
    </div>
    <div class="status-item">
      <span class="label">Dependency:</span>
      <span class="value">{{ data.dependency }}</span>
    </div>
    <div class="status-item">
      <span class="label">Hunger:</span>
      <span class="value">{{ data.status.hunger }}</span>
    </div>
    <div class="status-item">
      <span class="label">Fatigue:</span>
      <span class="value">{{ data.status.fatigue }}</span>
    </div>
    <div class="status-item">
      <span class="label">Happiness:</span>
      <span class="value">{{ data.status.happiness }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDataStore } from '../store';

const { data } = useDataStore();
</script>

<style scoped>
.kinako-status-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  font-family: Arial, sans-serif;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 5px;
}

.label {
  font-weight: bold;
  color: #ff99cc;
}

.value {
  color: #ffffff;
}
</style>
