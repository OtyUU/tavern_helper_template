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
      ref="currentImgRef"
      class="smart-image__layer"
      :class="{ 'smart-image__layer--entering': isSwapping }"
      :src="currentSrc"
      :alt="alt"
      @error="handleDisplayError"
      @load="handleDisplayLoad"
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
    mipTargetHeightPx?: number;
    enableMipmaps?: boolean;
    mipOversample?: number;
    mipMinifyRatio?: number;
    mipLanczosBlur?: number;
  }>(),
  {
    alt: '',
    swapDurationMs: 160,
    enableMipmaps: false,
    mipOversample: 1,
    mipMinifyRatio: 2.5,
    mipLanczosBlur: 1.06,
  },
);

const emit = defineEmits<{
  resolved: [payload: SmartImageResolvedPayload];
  resolutionStatus: [status: { resolved: string | null; failed: string[] }];
  swapStart: [payload: { duration: number }];
  mipStatus: [payload: {
    canonicalSrc: string;
    displaySrc: string;
    isMipped: boolean;
    naturalHeight: number;
    targetHeightPx: number;
    mipHeight: number | null;
    cachedKeys: string[];
  }];
}>();

const currentSrc = ref('');
const previousSrc = ref('');
const isSwapping = ref(false);
const loadGeneration = ref(0);
const swapResetHandle = ref<number | null>(null);
const failedCandidates = ref<string[]>([]);
let isComponentUnmounted = false;

const currentImgRef = ref<HTMLImageElement | null>(null);

const canonicalSrc = ref<string>('');
const canonicalMeta = ref<SmartImageResolvedPayload | null>(null);

const mipCache = new Map<string, string>();
const mipInFlightKey = ref<string | null>(null);
let mipGeneration = 0;

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

watch(
  () => props.mipTargetHeightPx,
  () => {
    void maybeUpdateMipChoice();
  },
);

function setDisplaySrc(next: string): void {
  if (!next || next === currentSrc.value) return;

  previousSrc.value = currentSrc.value;
  isSwapping.value = previousSrc.value !== '';
  currentSrc.value = next;

  if (isSwapping.value && props.swapDurationMs > 0) {
    emit('swapStart', { duration: props.swapDurationMs });
  }

  scheduleSwapCleanup();
}

async function syncCurrentSrc(candidates: string[], blockedSrc?: string) {
  const generation = ++loadGeneration.value;
  failedCandidates.value = [];
  const nextSrc = await resolveFirstCandidate(candidates, generation, blockedSrc);
  
  if (isComponentUnmounted || generation !== loadGeneration.value) {
    return;
  }

  if (!nextSrc) {
    emit('resolutionStatus', { resolved: null, failed: [...failedCandidates.value] });
    canonicalSrc.value = '';
    canonicalMeta.value = null;
    currentSrc.value = '';
    previousSrc.value = '';
    isSwapping.value = false;
    clearSwapResetHandle();
    return;
  }

  canonicalSrc.value = nextSrc.src;
  canonicalMeta.value = nextSrc;

  emit('resolutionStatus', { resolved: canonicalSrc.value, failed: [...failedCandidates.value] });

  if (canonicalSrc.value === currentSrc.value) {
    return;
  }

  emit('resolved', nextSrc);
  setDisplaySrc(nextSrc.src);

  void maybeUpdateMipChoice();
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function bucketHeight(px: number): number {
  const step = 32;
  return Math.max(step, Math.round(px / step) * step);
}

function shouldGenerateMip(meta: SmartImageResolvedPayload, targetHeightPx: number): boolean {
  if (!props.enableMipmaps) return false;
  if (!Number.isFinite(targetHeightPx) || targetHeightPx <= 0) return false;
  if (!Number.isFinite(meta.naturalHeight) || meta.naturalHeight <= 0) return false;

  const ratio = meta.naturalHeight / targetHeightPx;
  return ratio >= props.mipMinifyRatio;
}

function resolveDesiredMipHeight(meta: SmartImageResolvedPayload, targetHeightPx: number): number {
  const oversample = Number.isFinite(props.mipOversample) ? Math.max(1, props.mipOversample) : 2;
  const desired = Math.round(targetHeightPx * oversample);
  return clampNumber(desired, targetHeightPx, meta.naturalHeight);
}

function emitMipStatus(mipHeight: number | null = null) {
  if (!props.enableMipmaps) return;
  const meta = canonicalMeta.value;
  const target = props.mipTargetHeightPx ?? 0;
  emit('mipStatus', {
    canonicalSrc: canonicalSrc.value || '(none)',
    displaySrc: currentSrc.value || '(none)',
    isMipped: currentSrc.value.startsWith('blob:'),
    naturalHeight: meta?.naturalHeight ?? 0,
    targetHeightPx: target,
    mipHeight,
    cachedKeys: [...mipCache.keys()],
  });
}

async function maybeUpdateMipChoice(): Promise<void> {
  if (!props.enableMipmaps) return;
  if (!canonicalSrc.value || !canonicalMeta.value) return;

  const target = props.mipTargetHeightPx ?? 0;
  const meta = canonicalMeta.value;

  if (!shouldGenerateMip(meta, target)) {
    mipGeneration++;
    mipInFlightKey.value = null;
    if (currentSrc.value && currentSrc.value.startsWith('blob:')) {
      setDisplaySrc(canonicalSrc.value);
    }
    emitMipStatus();
    return;
  }

  const mipH = resolveDesiredMipHeight(meta, target);
  const key = `${canonicalSrc.value}|h${mipH}`;

  const cached = mipCache.get(key);
  if (cached) {
    if (currentSrc.value === canonicalSrc.value) {
      setDisplaySrc(cached);
    }
    emitMipStatus(mipH);
    return;
  }

  if (currentSrc.value !== canonicalSrc.value) {
    return;
  }

  const img = currentImgRef.value;
  if (!img) return;
  if (!img.complete) return;
  if ((img.naturalHeight || 0) <= 0) return;

  if (mipInFlightKey.value === key) return;
  mipInFlightKey.value = key;

  const gen = ++mipGeneration;

  const run = async () => {
    try {
      const url = await generateMipBlobUrlFromImage(img, mipH);
      if (!url) return;
      if (isComponentUnmounted) {
        URL.revokeObjectURL(url);
        return;
      }
      if (gen !== mipGeneration) {
        URL.revokeObjectURL(url);
        return;
      }
      mipCache.set(key, url);
      mipInFlightKey.value = null;
      if (currentSrc.value === canonicalSrc.value) {
        setDisplaySrc(url);
      }
      emitMipStatus(mipH);
    } catch (error) {
      mipInFlightKey.value = null;
      console.warn('[RenPy Player] SmartImage mip generation failed:', error);
    }
  };

  if (typeof (window as any).requestIdleCallback === 'function') {
    (window as any).requestIdleCallback(() => void run(), { timeout: 250 });
  } else {
    window.setTimeout(() => void run(), 0);
  }
}

function handleDisplayLoad() {
  void maybeUpdateMipChoice();
}

const SRGB_TO_LINEAR = (() => {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const s = i / 255;
    lut[i] = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }
  return lut;
})();

function linearToSrgb8(x: number): number {
  x = Math.min(1, Math.max(0, x));
  const s = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

function lanczos3Kernel(x: number, blur: number): number {
  x = x / blur;
  if (x === 0) return 1;
  if (Math.abs(x) >= 3) return 0;
  const px = Math.PI * x;
  return (Math.sin(px) / px) * (Math.sin(px / 3) / (px / 3));
}

function lanczosResize(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  blur: number,
): Uint8ClampedArray {
  const pixelCount = srcW * srcH;
  const srcF = new Float32Array(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    const si = i * 4;
    const a = src[si + 3] / 255;
    const rL = SRGB_TO_LINEAR[src[si]];
    const gL = SRGB_TO_LINEAR[src[si + 1]];
    const bL = SRGB_TO_LINEAR[src[si + 2]];
    srcF[si] = rL * a;
    srcF[si + 1] = gL * a;
    srcF[si + 2] = bL * a;
    srcF[si + 3] = a;
  }

  const hRatio = srcW / dstW;
  const hSupport = Math.ceil(3 * blur * hRatio);
  const hBuf = new Float32Array(dstW * srcH * 4);

  for (let y = 0; y < srcH; y++) {
    for (let dx = 0; dx < dstW; dx++) {
      const center = (dx + 0.5) * hRatio - 0.5;
      const lo = Math.max(0, Math.ceil(center - hSupport));
      const hi = Math.min(srcW - 1, Math.floor(center + hSupport));
      let r = 0, g = 0, b = 0, a = 0, wS = 0;
      for (let sx = lo; sx <= hi; sx++) {
        const w = lanczos3Kernel((sx - center) / hRatio, blur);
        const si = (y * srcW + sx) * 4;
        r += srcF[si] * w;
        g += srcF[si + 1] * w;
        b += srcF[si + 2] * w;
        a += srcF[si + 3] * w;
        wS += w;
      }
      const di = (y * dstW + dx) * 4;
      hBuf[di] = r / wS;
      hBuf[di + 1] = g / wS;
      hBuf[di + 2] = b / wS;
      hBuf[di + 3] = a / wS;
    }
  }

  const vRatio = srcH / dstH;
  const vSupport = Math.ceil(3 * blur * vRatio);
  const dst = new Uint8ClampedArray(dstW * dstH * 4);

  for (let dy = 0; dy < dstH; dy++) {
    const center = (dy + 0.5) * vRatio - 0.5;
    const lo = Math.max(0, Math.ceil(center - vSupport));
    const hi = Math.min(srcH - 1, Math.floor(center + vSupport));
    for (let dx = 0; dx < dstW; dx++) {
      let r = 0, g = 0, b = 0, a = 0, wS = 0;
      for (let sy = lo; sy <= hi; sy++) {
        const w = lanczos3Kernel((sy - center) / vRatio, blur);
        const si = (sy * dstW + dx) * 4;
        r += hBuf[si] * w;
        g += hBuf[si + 1] * w;
        b += hBuf[si + 2] * w;
        a += hBuf[si + 3] * w;
        wS += w;
      }
      const di = (dy * dstW + dx) * 4;
      const aOut = a / wS;
      const aClamp = Math.min(1, Math.max(0, aOut));
      dst[di + 3] = Math.max(0, Math.min(255, Math.round(aClamp * 255)));
      if (aClamp > 0) {
        dst[di] = linearToSrgb8((r / wS) / aClamp);
        dst[di + 1] = linearToSrgb8((g / wS) / aClamp);
        dst[di + 2] = linearToSrgb8((b / wS) / aClamp);
      } else {
        dst[di] = 0;
        dst[di + 1] = 0;
        dst[di + 2] = 0;
      }
    }
  }

  return dst;
}

function canvasBilinearStep(
  srcCanvas: HTMLCanvasElement,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): HTMLCanvasElement | null {
  const c = document.createElement('canvas');
  c.width = dstW;
  c.height = dstH;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  // @ts-expect-error older TS libs may not include imageSmoothingQuality
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(srcCanvas, 0, 0, srcW, srcH, 0, 0, dstW, dstH);
  return c;
}

async function generateMipBlobUrlFromImage(img: HTMLImageElement, targetHeight: number): Promise<string | null> {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (srcW <= 0 || srcH <= 0) return null;

  const targetH = clampNumber(Math.round(targetHeight), 1, srcH);
  const targetW = clampNumber(Math.round(srcW * (targetH / srcH)), 1, srcW);

  let curCanvas = document.createElement('canvas');
  curCanvas.width = srcW;
  curCanvas.height = srcH;
  const initCtx = curCanvas.getContext('2d');
  if (!initCtx) return null;

  initCtx.imageSmoothingEnabled = true;
  // @ts-expect-error older TS libs may not include imageSmoothingQuality
  initCtx.imageSmoothingQuality = 'high';
  initCtx.drawImage(img, 0, 0, srcW, srcH);

  let curW = srcW;
  let curH = srcH;

  while (curH > targetH * 2) {
    const nextW = Math.max(1, Math.round(curW / 2));
    const nextH = Math.max(1, Math.round(curH / 2));
    const next = canvasBilinearStep(curCanvas, curW, curH, nextW, nextH);
    if (!next) break;
    curCanvas = next;
    curW = nextW;
    curH = nextH;
  }

  if (curW !== targetW || curH !== targetH) {
    try {
      const ctx = curCanvas.getContext('2d');
      if (!ctx) throw new Error('no ctx');
      const imageData = ctx.getImageData(0, 0, curW, curH);
      const resized = lanczosResize(imageData.data, curW, curH, targetW, targetH, props.mipLanczosBlur ?? 1.06);
      const outCanvas = document.createElement('canvas');
      outCanvas.width = targetW;
      outCanvas.height = targetH;
      const outCtx = outCanvas.getContext('2d');
      if (!outCtx) return null;
      outCtx.putImageData(new ImageData(resized, targetW, targetH), 0, 0);
      curCanvas = outCanvas;
    } catch {
      const fallback = canvasBilinearStep(curCanvas, curW, curH, targetW, targetH);
      if (!fallback) return null;
      curCanvas = fallback;
    }
  }

  const blob = await new Promise<Blob | null>(resolve => {
    try {
      curCanvas.toBlob(
        b => resolve(b),
        'image/png',
      );
    } catch {
      resolve(null);
    }
  });

  if (!blob) return null;
  return URL.createObjectURL(blob);
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
  mipGeneration++;
  mipInFlightKey.value = null;

  clearSwapResetHandle();

  for (const url of mipCache.values()) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
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
