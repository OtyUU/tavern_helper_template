<template>
  <div class="smart-image" :style="smartImageStyle">
    <canvas
      ref="prevCanvasRef"
      class="smart-image__layer smart-image__layer--previous"
      :class="{ 'smart-image__layer--exiting': isSwapping }"
      aria-hidden="true"
    ></canvas>
    <canvas
      ref="currCanvasRef"
      class="smart-image__layer"
      :class="{ 'smart-image__layer--entering': isSwapping }"
      :aria-label="alt"
    ></canvas>
  </div>
</template>

<script setup lang="ts">
import Pica from 'pica';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

// Singleton — Pica creates Web Workers; one for the whole app is cheaper.
const picaInstance = new Pica({ features: ['js', 'wasm', 'cib'] });

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
    /**
     * Target height for Lanczos3 resampling (in pixels).
     * Passed from SceneLayer as stageHeight * X.
     * Resampling is applied only if naturalHeight > resampleTargetHeight * 1.1 (downsampling).
     */
    resampleTargetHeight?: number;
  }>(),
  {
    alt: '',
    swapDurationMs: 160,
    resampleTargetHeight: undefined,
  },
);

const emit = defineEmits<{
  resolved: [payload: SmartImageResolvedPayload];
  resolutionStatus: [status: { resolved: string | null; failed: string[] }];
  swapStart: [payload: { duration: number }];
}>();

const currCanvasRef = ref<HTMLCanvasElement | null>(null);
const prevCanvasRef = ref<HTMLCanvasElement | null>(null);
const isSwapping = ref(false);
const loadGeneration = ref(0);
const swapResetHandle = ref<number | null>(null);
const failedCandidates = ref<string[]>([]);
let isComponentUnmounted = false;

const currentAssetSrc = ref('');

// ─── Core load pipeline ────────────────────────────────────────────────────

const smartImageStyle = computed(() => ({
  '--smart-image-swap-ms': `${Math.max(props.swapDurationMs, 0)}ms`,
}));

let lastCandidatesSignature = '';

watch(
  [() => props.candidates, () => props.resampleTargetHeight],
  ([candidates, resampleTargetHeight]) => {
    const signature = `${candidates.join('|')}@${resampleTargetHeight}`;
    if (signature === lastCandidatesSignature) return;
    lastCandidatesSignature = signature;
    void syncCurrentSrc(candidates);
  },
  { immediate: true },
);

async function syncCurrentSrc(candidates: string[], blockedSrc?: string) {
  const generation = ++loadGeneration.value;
  failedCandidates.value = [];
  const result = await resolveFirstCandidate(candidates, generation, blockedSrc);

  if (isComponentUnmounted || generation !== loadGeneration.value) {
    return;
  }

  if (!result) {
    emit('resolutionStatus', { resolved: null, failed: [...failedCandidates.value] });
    currentAssetSrc.value = '';
    isSwapping.value = false;
    clearSwapResetHandle();
    clearCanvas(currCanvasRef.value);
    clearCanvas(prevCanvasRef.value);
    return;
  }

  emit('resolutionStatus', { resolved: result.payload.src, failed: [...failedCandidates.value] });
  if (result.payload.src === currentAssetSrc.value) {
    return;
  }

  emit('resolved', result.payload);

  // Prepare swap: move current content to previous canvas
  prepareSwap();
  
  currentAssetSrc.value = result.payload.src;

  // Draw new content to current canvas
  await drawResultToCanvas(currCanvasRef.value, result.img, result.payload);

  if (isSwapping.value && props.swapDurationMs > 0) {
    emit('swapStart', { duration: props.swapDurationMs });
  }

  scheduleSwapCleanup();
}

function prepareSwap() {
  if (currCanvasRef.value && prevCanvasRef.value && currentAssetSrc.value) {
    const prev = prevCanvasRef.value;
    const curr = currCanvasRef.value;
    prev.width = curr.width;
    prev.height = curr.height;
    const ctx = prev.getContext('2d');
    if (ctx) {
      ctx.drawImage(curr, 0, 0);
    }
    isSwapping.value = true;
  }
}

async function drawResultToCanvas(
  canvas: HTMLCanvasElement | null,
  img: HTMLImageElement,
  payload: SmartImageResolvedPayload
) {
  if (!canvas) return;

  const targetH = props.resampleTargetHeight;
  const shouldResample =
    targetH !== undefined &&
    targetH > 0 &&
    payload.naturalHeight > targetH * 1.02;

  const aspect = payload.naturalWidth / payload.naturalHeight;
  const dstHeight = shouldResample ? targetH! : payload.naturalHeight;
  const dstWidth = Math.max(1, Math.round(dstHeight * aspect));

  canvas.width = dstWidth;
  canvas.height = dstHeight;

  if (shouldResample) {
    try {
      await picaInstance.resize(img, canvas, {
        quality: 3,
        // Using Lanczos3 as in the user's prototype
        unsharpAmount: 0, 
      });
    } catch (err) {
      console.warn('[RenPy Player] SmartImage: pica failed, fallback to drawImage', err);
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(img, 0, 0, dstWidth, dstHeight);
    }
  } else {
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.drawImage(img, 0, 0, dstWidth, dstHeight);
  }
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, 1, 1);
}

async function resolveFirstCandidate(
  candidates: string[],
  generation: number,
  blockedSrc?: string,
): Promise<{ payload: SmartImageResolvedPayload, img: HTMLImageElement } | null> {
  for (const candidate of candidates) {
    if (!candidate || candidate === blockedSrc) {
      continue;
    }

    const imageMetadata = await loadImage(candidate);
    if (generation !== loadGeneration.value) {
      return null;
    }

    if (imageMetadata) {
      return {
        payload: {
          src: candidate,
          naturalWidth: imageMetadata.naturalWidth,
          naturalHeight: imageMetadata.naturalHeight,
        },
        img: imageMetadata.img
      };
    }

    failedCandidates.value.push(candidate);
  }

  console.warn('[RenPy Player] SmartImage exhausted all candidates.');
  return null;
}

/**
 * Loads HTMLImageElement and calls decode().
 * Returns { img, naturalWidth, naturalHeight } or null on error.
 */
function loadImage(src: string): Promise<{
  img: HTMLImageElement;
  naturalWidth: number;
  naturalHeight: number;
} | null> {
  return new Promise(resolve => {
    const image = new Image();
    image.decoding = 'async';

    image.onload = () => {
      const metadata = {
        img: image,
        naturalWidth: image.naturalWidth || image.width,
        naturalHeight: image.naturalHeight || image.height,
      };

      if (typeof image.decode === 'function') {
        image.decode()
          .catch(() => undefined)
          .finally(() => resolve(metadata));
        return;
      }

      resolve(metadata);
    };

    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/**
 * Schedules cleanup of previous canvas after swap animation ends.
 */
function scheduleSwapCleanup() {
  clearSwapResetHandle();

  if (!isSwapping.value) {
    clearCanvas(prevCanvasRef.value);
    return;
  }

  swapResetHandle.value = window.setTimeout(() => {
    isSwapping.value = false;
    swapResetHandle.value = null;
    clearCanvas(prevCanvasRef.value);
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