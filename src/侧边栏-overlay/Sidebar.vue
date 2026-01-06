<template>
  <div v-if="isOpen" class="sidebar-overlay" :style="positionStyle">
    <div class="sidebar-header">
      <h3>侧边栏</h3>
      <button class="close-btn" @click="close">×</button>
    </div>
    <div class="sidebar-content">
      <div class="url-input-section">
        <input v-model="urlInput" placeholder="输入HTML接口链接..." @keyup.enter="loadUrl" />
        <button @click="loadUrl" class="load-btn">加载</button>
      </div>

      <div class="presets-section">
        <h4>预设接口</h4>
        <button v-for="preset in presets" :key="preset.name" @click="loadPreset(preset)" class="preset-btn">
          {{ preset.name }}
        </button>
      </div>

      <div v-if="loadedUrls.length > 0" class="loaded-section">
        <h4>已加载接口</h4>
        <div v-for="url in loadedUrls" :key="url" class="loaded-item">
          <span>{{ url }}</span>
          <button @click="unloadUrl(url)" class="unload-btn">卸载</button>
        </div>
      </div>
    </div>

    <div class="resize-handle" @mousedown="startResize"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const isOpen = ref(false);
const urlInput = ref('');
const loadedUrls = ref<string[]>([]);
const position = ref({ x: 20, y: 100 });
const size = ref({ width: 300, height: 400 });

const presets = [{ name: '界面示例', url: 'dist/界面示例/index.html' }];

const positionStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
  width: `${size.value.width}px`,
  height: `${size.value.height}px`,
}));

function toggle() {
  isOpen.value = !isOpen.value;
}

function close() {
  isOpen.value = false;
}

function loadUrl() {
  const url = urlInput.value.trim();
  if (!url) {
    toastr.warning('请输入有效的URL');
    return;
  }

  if (loadedUrls.value.includes(url)) {
    toastr.info('该接口已加载');
    return;
  }

  loadedUrls.value.push(url);
  urlInput.value = '';
  toastr.success(`已加载接口: ${url}`);

  // In a real implementation, this would trigger the actual interface loading
  console.log('Loading URL:', url);
}

function loadPreset(preset: { name: string; url: string }) {
  urlInput.value = preset.url;
  loadUrl();
}

function unloadUrl(url: string) {
  const index = loadedUrls.value.indexOf(url);
  if (index > -1) {
    loadedUrls.value.splice(index, 1);
    toastr.success(`已卸载接口: ${url}`);

    // In a real implementation, this would trigger the actual interface unloading
    console.log('Unloading URL:', url);
  }
}

function startResize(event: MouseEvent) {
  const startX = event.clientX;
  const startY = event.clientY;
  const startWidth = size.value.width;
  const startHeight = size.value.height;

  function onMouseMove(e: MouseEvent) {
    size.value.width = Math.max(200, startWidth + e.clientX - startX);
    size.value.height = Math.max(200, startHeight + e.clientY - startY);
  }

  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

// Expose toggle function
window.$sidebarToggle = toggle;
</script>
