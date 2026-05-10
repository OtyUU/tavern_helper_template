<template>
  <div ref="rootRef" class="smart-image" :style="smartImageStyle">
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

type CandidateMeta = SmartImageResolvedPayload & { image: HTMLImageElement };

type MipEntry = {
  height: number;
  url: string;
  lastUsed: number;
};

const props = withDefaults(
  defineProps<{
    candidates: string[];
    alt?: string;
    swapDurationMs?: number;
    downscale?: boolean;
    targetHeightPx?: number | null;
    downscaleOversize?: number;
    downscaleMinRatio?: number;
  }>(),
  {
    alt: '',
    swapDurationMs: 160,
    downscale: false,
    targetHeightPx: null,
    downscaleOversize: 3.0,
    downscaleMinRatio: 1.35,
  },
);

const emit = defineEmits<{
  resolved: [payload: SmartImageResolvedPayload];
  resolutionStatus: [status: { resolved: string | null; failed: string[] }];
}>();

const rootRef = ref<HTMLElement | null>(null);

const currentSrc = ref('');
const previousSrc = ref('');
const resolvedCandidateSrc = ref('');
const isSwapping = ref(false);
const loadGeneration = ref(0);
const swapResetHandle = ref<number | null>(null);
const failedCandidates = ref<string[]>([]);

const mipCache = new Map<string, MipEntry[]>();
const MAX_MIP_ENTRIES_PER_SRC = 4;

const smartImageStyle = computed(() => ({
  '--smart-image-swap-ms': `${Math.max(props.swapDurationMs, 0)}ms`,
}));

const candidateKey = computed(() => props.candidates.join('\n'));

watch(
  [candidateKey, () => props.downscale, () => props.targetHeightPx],
  () => {
    void syncCurrentSrc([...props.candidates]);
  },
  { immediate: true },
);

function now() {
  return performance?.now?.() ?? Date.now();
}

function resolveDesiredPhysicalHeight(): number | null {
  const dpr = window.devicePixelRatio || 1;

  if (props.targetHeightPx && props.targetHeightPx > 0) {
    return Math.max(1, Math.round(props.targetHeightPx * dpr * props.downscaleOversize));
  }

  const el = rootRef.value;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (!rect.height || rect.height <= 0) return null;
  return Math.max(1, Math.round(rect.height * dpr * props.downscaleOversize));
}

function pickCachedMip(entries: MipEntry[], desired: number): MipEntry | null {
  let best: MipEntry | null = null;
  for (const e of entries) {
    if (e.height >= desired && (!best || e.height < best.height)) best = e;
  }
  return best;
}

function touchMip(originalSrc: string, entry: MipEntry) {
  entry.lastUsed = now();
}

function evictOldMips(originalSrc: string) {
  const list = mipCache.get(originalSrc);
  if (!list) return;
  if (list.length <= MAX_MIP_ENTRIES_PER_SRC) return;

  list.sort((a, b) => a.lastUsed - b.lastUsed);
  while (list.length > MAX_MIP_ENTRIES_PER_SRC) {
    const victim = list.shift();
    if (victim) {
      try { URL.revokeObjectURL(victim.url); } catch {}
    }
  }
}

async function createMipFromImage(meta: CandidateMeta, targetPhysicalHeight: number): Promise<MipEntry | null> {
  const naturalH = meta.naturalHeight;
  const naturalW = meta.naturalWidth;

  if (targetPhysicalHeight >= naturalH) return null;

  const scale = targetPhysicalHeight / naturalH;
  const targetH = Math.max(1, Math.round(naturalH * scale));
  const targetW = Math.max(1, Math.round(naturalW * scale));

  try {
    const bitmap = await createImageBitmap(meta.image, {
      resizeWidth: targetW,
      resizeHeight: targetH,
      resizeQuality: 'high',
    } as any);

    let blob: Blob | null = null;

    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(targetW, targetH);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      (ctx as any).imageSmoothingEnabled = true;
      (ctx as any).imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      blob = await canvas.convertToBlob({ type: 'image/png' });
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      (ctx as any).imageSmoothingEnabled = true;
      (ctx as any).imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);

      blob = await new Promise<Blob | null>(resolve => {
        canvas.toBlob(b => resolve(b), 'image/png');
      });
    }

    bitmap.close?.();

    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    return { height: targetPhysicalHeight, url, lastUsed: now() };
  } catch {
    return null;
  }
}

async function maybeGetOrCreateMip(meta: CandidateMeta, generation: number): Promise<string | null> {
  if (!props.downscale) return null;

  const desired = resolveDesiredPhysicalHeight();
  if (!desired) return null;

  const ratio = meta.naturalHeight / desired;
  if (ratio < props.downscaleMinRatio) return null;

  const originalSrc = meta.src;
  const entries = mipCache.get(originalSrc) ?? [];
  const cached = pickCachedMip(entries, desired);
  if (cached) {
    touchMip(originalSrc, cached);
    return cached.url;
  }

  const created = await createMipFromImage(meta, desired);
  if (generation !== loadGeneration.value) return null;
  if (!created) return null;

  const nextList = mipCache.get(originalSrc) ?? [];
  nextList.push(created);
  mipCache.set(originalSrc, nextList);
  evictOldMips(originalSrc);

  return created.url;
}

async function syncCurrentSrc(candidates: string[], blockedSrc?: string) {
  const generation = ++loadGeneration.value;
  failedCandidates.value = [];

  const meta = await resolveFirstCandidate(candidates, generation, blockedSrc);
  if (generation !== loadGeneration.value) return;

  if (!meta) {
    emit('resolutionStatus', { resolved: null, failed: [...failedCandidates.value] });
    resolvedCandidateSrc.value = '';
    currentSrc.value = '';
    previousSrc.value = '';
    isSwapping.value = false;
    clearSwapResetHandle();
    return;
  }

  emit('resolutionStatus', { resolved: meta.src, failed: [...failedCandidates.value] });
  emit('resolved', { src: meta.src, naturalWidth: meta.naturalWidth, naturalHeight: meta.naturalHeight });

  resolvedCandidateSrc.value = meta.src;

  if (meta.src !== currentSrc.value) {
    previousSrc.value = currentSrc.value;
    isSwapping.value = previousSrc.value !== '';
    currentSrc.value = meta.src;
    scheduleSwapCleanup();
  }

  const mipUrl = await maybeGetOrCreateMip(meta, generation);
  if (generation !== loadGeneration.value) return;
  if (!mipUrl) return;

  if (resolvedCandidateSrc.value !== meta.src) return;
  if (currentSrc.value === mipUrl) return;

  previousSrc.value = currentSrc.value;
  isSwapping.value = previousSrc.value !== '';
  currentSrc.value = mipUrl;
  scheduleSwapCleanup();
}

async function resolveFirstCandidate(candidates: string[], generation: number, blockedSrc?: string) {
  for (const candidate of candidates) {
    if (!candidate || candidate === blockedSrc) continue;

    const meta = await preloadCandidate(candidate);
    if (generation !== loadGeneration.value) return null;

    if (meta) return meta;
    failedCandidates.value.push(candidate);
  }
  return null;
}

function preloadCandidate(src: string) {
  return new Promise<CandidateMeta | null>(resolve => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const meta: CandidateMeta = {
        src,
        naturalWidth: image.naturalWidth || image.width,
        naturalHeight: image.naturalHeight || image.height,
        image,
      };
      if (typeof image.decode === 'function') {
        image.decode().catch(() => undefined).finally(() => resolve(meta));
        return;
      }
      resolve(meta);
    };
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function handleDisplayError() {
  if (currentSrc.value.startsWith('blob:') && resolvedCandidateSrc.value) {
    previousSrc.value = currentSrc.value;
    isSwapping.value = previousSrc.value !== '';
    currentSrc.value = resolvedCandidateSrc.value;
    scheduleSwapCleanup();
    return;
  }

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
  clearSwapResetHandle();
  for (const entries of mipCache.values()) {
    for (const e of entries) {
      try { URL.revokeObjectURL(e.url); } catch {}
    }
  }
  mipCache.clear();
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
