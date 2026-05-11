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
type SmartImageResolvedPayload = {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
};

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

const emit = defineEmits<{
  resolved: [payload: SmartImageResolvedPayload];
  resolutionStatus: [status: { resolved: string | null; failed: string[] }];
  swapStart: [payload: { duration: number }];
}>();

const currentSrc = ref('');
const previousSrc = ref('');
const isSwapping = ref(false);
const loadGeneration = ref(0);
const swapResetHandle = ref<number | null>(null);
const failedCandidates = ref<string[]>([]);
let isComponentUnmounted = false;

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
  failedCandidates.value = [];
  const nextSrc = await resolveFirstCandidate(candidates, generation, blockedSrc);
  
  if (isComponentUnmounted || generation !== loadGeneration.value) {
    return;
  }

  if (!nextSrc) {
    emit('resolutionStatus', { resolved: null, failed: [...failedCandidates.value] });
    currentSrc.value = '';
    previousSrc.value = '';
    isSwapping.value = false;
    clearSwapResetHandle();
    return;
  }

  emit('resolutionStatus', { resolved: nextSrc.src, failed: [...failedCandidates.value] });
  if (nextSrc.src === currentSrc.value) {
    return;
  }

  emit('resolved', nextSrc);
  previousSrc.value = currentSrc.value;
  isSwapping.value = previousSrc.value !== '';
  currentSrc.value = nextSrc.src;
  
  if (isSwapping.value && props.swapDurationMs > 0) {
    emit('swapStart', { duration: props.swapDurationMs });
  }
  
  scheduleSwapCleanup();
}

async function resolveFirstCandidate(candidates: string[], generation: number, blockedSrc?: string) {
  for (const candidate of candidates) {
    if (!candidate || candidate === blockedSrc) {
      continue;
    }

    const metadata = await preloadCandidate(candidate);
    if (generation !== loadGeneration.value) {
      return null;
    }

    if (metadata) {
      return metadata;
    }

    failedCandidates.value.push(candidate);
  }

  console.warn('[RenPy Player] SmartImage exhausted all candidates.');
  return null;
}

function preloadCandidate(src: string) {
  return new Promise<SmartImageResolvedPayload | null>(resolve => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const metadata = {
        src,
        naturalWidth: image.naturalWidth || image.width,
        naturalHeight: image.naturalHeight || image.height,
      };
      if (typeof image.decode === 'function') {
        image.decode().catch(() => undefined).finally(() => resolve(metadata));
        return;
      }

      resolve(metadata);
    };
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function handleDisplayError() {
  console.warn(`[RenPy Player] SmartImage display failed: ${currentSrc.value}`);
  const failed = currentSrc.value;
  void syncCurrentSrc(props.candidates, failed);
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
  isComponentUnmounted = true;
  loadGeneration.value++;
  
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
