<template>
  <div class="kinako-status-bar">
    <div class="status-item">
      <span class="label">好感度:</span>
      <span class="value">{{ data.好感度 }}</span>
    </div>
    <div class="status-item">
      <span class="label">情绪:</span>
      <span class="value">{{ data.情绪 }}</span>
    </div>
    <div class="status-item">
      <span class="label">能量:</span>
      <span class="value">{{ data.能量 }}</span>
    </div>
    <div class="status-item">
      <span class="label">信任度:</span>
      <span class="value">{{ data.信任度 }}</span>
    </div>
    <div class="status-item">
      <span class="label">依赖度:</span>
      <span class="value">{{ data.依赖度 }}</span>
    </div>
    <div class="status-item">
      <span class="label">饥饿:</span>
      <span class="value">{{ data.状态.饥饿 }}</span>
    </div>
    <div class="status-item">
      <span class="label">疲劳:</span>
      <span class="value">{{ data.状态.疲劳 }}</span>
    </div>
    <div class="status-item">
      <span class="label">快乐:</span>
      <span class="value">{{ data.状态.快乐 }}</span>
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
