<template>
  <div class="smart-image" :style="smartImageStyle">
    <img
      v-if="previousSrc"
      class="smart-image__layer smart-image__layer--previous"
      :class="{ 'smart-image__layer--exiting': isSwapping }"
      :src="previousSrc"
      alt=""
      aria-hidden="true"
    />
    <img
      v-if="currentSrc"
      class="smart-image__layer"
      :class="{ 'smart-image__layer--entering': isSwapping }"
      :src="currentSrc"
      :alt="alt"
      @error="handleDisplayError"
    />
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    candidates: string[];
    alt?: string;
    swapDurationMs?: number;
  }>(),
  {
    alt: '',
    swapDurationMs: 160,
  },
);

const currentSrc = ref('');
const previousSrc = ref('');
const isSwapping = ref(false);
const loadGeneration = ref(0);
const swapResetHandle = ref<number | null>(null);

const smartImageStyle = computed(() => ({
  '--smart-image-swap-ms': `${Math.max(props.swapDurationMs, 0)}ms`,
}));

watch(
  () => [...props.candidates],
  candidates => {
    void syncCurrentSrc(candidates);
  },
  { immediate: true },
);

async function syncCurrentSrc(candidates: string[], blockedSrc?: string) {
  const generation = ++loadGeneration.value;
  const nextSrc = await resolveFirstCandidate(candidates, generation, blockedSrc);
  if (generation !== loadGeneration.value) {
    return;
  }

  if (!nextSrc) {
    currentSrc.value = '';
    previousSrc.value = '';
    isSwapping.value = false;
    clearSwapResetHandle();
    return;
  }

  if (nextSrc === currentSrc.value) {
    return;
  }

  previousSrc.value = currentSrc.value;
  isSwapping.value = previousSrc.value !== '';
  currentSrc.value = nextSrc;
  scheduleSwapCleanup();
}

async function resolveFirstCandidate(candidates: string[], generation: number, blockedSrc?: string) {
  for (const candidate of candidates) {
    if (!candidate || candidate === blockedSrc) {
      continue;
    }

    const isLoaded = await preloadCandidate(candidate);
    if (generation !== loadGeneration.value) {
      return null;
    }

    if (isLoaded) {
      return candidate;
    }

    console.warn(`[RenPy Player] SmartImage failed candidate: ${candidate}`);
  }

  console.warn('[RenPy Player] SmartImage exhausted all candidates.');
  return null;
}

function preloadCandidate(src: string) {
  return new Promise<boolean>(resolve => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (typeof image.decode === 'function') {
        image.decode().catch(() => undefined).finally(() => resolve(true));
        return;
      }

      resolve(true);
    };
    image.onerror = () => resolve(false);
    image.src = src;
  });
}

function handleDisplayError() {
  console.warn(`[RenPy Player] SmartImage display failed: ${currentSrc.value}`);
  void syncCurrentSrc(props.candidates, currentSrc.value);
}

function scheduleSwapCleanup() {
  clearSwapResetHandle();
  if (!isSwapping.value) {
    previousSrc.value = '';
    return;
  }

  swapResetHandle.value = window.setTimeout(() => {
    previousSrc.value = '';
    isSwapping.value = false;
    swapResetHandle.value = null;
  }, Math.max(props.swapDurationMs, 0));
}

function clearSwapResetHandle() {
  if (swapResetHandle.value !== null) {
    window.clearTimeout(swapResetHandle.value);
    swapResetHandle.value = null;
  }
}

onBeforeUnmount(() => {
  clearSwapResetHandle();
});
</script>

<style scoped>
.smart-image {
  position: relative;
  width: 100%;
  height: 100%;
}

.smart-image__layer {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: inherit;
  object-position: inherit;
}

.smart-image__layer--previous {
  position: absolute;
  inset: 0;
}

.smart-image__layer--exiting {
  animation: smart-image-exit var(--smart-image-swap-ms) ease-out forwards;
}

.smart-image__layer--entering {
  position: relative;
  z-index: 1;
  animation: smart-image-enter var(--smart-image-swap-ms) ease-out forwards;
}

@keyframes smart-image-enter {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes smart-image-exit {
  from { opacity: 1; }
  to { opacity: 0; }
}
</style>
