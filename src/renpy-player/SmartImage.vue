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
import Pica from 'pica';

// Singleton — Pica создаёт Web Workers; один на всё приложение дешевле.
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
     * Целевая высота для Lanczos3 ресемплинга (в пикселях).
     * Передаётся из SceneLayer как stageHeight * 2.
     * Ресемплинг применяется только если naturalHeight > resampleTargetHeight * 1.5,
     * т.е. исходник минимум в 1.5 раза крупнее цели (downsampling, не upsampling).
     * Если undefined — ресемплинг отключён, поведение как раньше.
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

const currentSrc = ref('');
const previousSrc = ref('');
const isSwapping = ref(false);
const loadGeneration = ref(0);
const swapResetHandle = ref<number | null>(null);
const failedCandidates = ref<string[]>([]);
let isComponentUnmounted = false;

// ─── Blob URL lifecycle ────────────────────────────────────────────────────
// Храним все blob URL, которые мы создали, чтобы revokeObjectURL не утекали.
// Ключ — blob URL строка. Значение не важно (используем Set).
const ownedBlobUrls = new Set<string>();

function registerBlobUrl(url: string): void {
  if (url.startsWith('blob:')) {
    ownedBlobUrls.add(url);
  }
}

/**
 * Отзывает blob URL если он наш и не используется ни в currentSrc, ни в previousSrc.
 * Вызываем только когда URL точно не отображается.
 */
function safeRevokeBlobUrl(url: string): void {
  if (!url.startsWith('blob:')) return;
  if (!ownedBlobUrls.has(url)) return;
  // Не отзываем пока URL ещё показывается (currentSrc или previousSrc во время свапа)
  if (url === currentSrc.value || url === previousSrc.value) return;
  URL.revokeObjectURL(url);
  ownedBlobUrls.delete(url);
}

function revokeAllOwnedBlobUrls(): void {
  for (const url of ownedBlobUrls) {
    URL.revokeObjectURL(url);
  }
  ownedBlobUrls.clear();
}

// ─── Pica resampling ───────────────────────────────────────────────────────

/**
 * Создаёт ImageBitmap из HTMLImageElement через OffscreenCanvas (без layout thrashing).
 * Fallback — обычный Canvas если OffscreenCanvas недоступен.
 */
async function createSourceCanvas(img: HTMLImageElement): Promise<HTMLCanvasElement> {
  const src = document.createElement('canvas');
  src.width = img.naturalWidth;
  src.height = img.naturalHeight;
  const ctx = src.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('SmartImage: cannot get 2d context for pica source');
  ctx.drawImage(img, 0, 0);
  return src;
}

/**
 * Ресемплирует img до targetHeight с сохранением aspect ratio через Pica Lanczos3.
 * Возвращает blob: URL с результатом в PNG (lossless — без re-encoding artifacts).
 *
 * Caller обязан зарегистрировать результат через registerBlobUrl().
 */
async function picaResample(
  img: HTMLImageElement,
  targetHeight: number,
): Promise<{ blobUrl: string; width: number; height: number }> {
  const srcCanvas = await createSourceCanvas(img);

  const aspect = img.naturalWidth / img.naturalHeight;
  const dstHeight = targetHeight;
  const dstWidth = Math.max(1, Math.round(dstHeight * aspect));

  const dst = document.createElement('canvas');
  dst.width = dstWidth;
  dst.height = dstHeight;

  await picaInstance.resize(srcCanvas, dst, {
    quality: 3,
    unsharpAmount: 100,
    unsharpRadius: 0.6,
    unsharpThreshold: 4,
  });

  const blob = await new Promise<Blob>((resolve, reject) => {
    dst.toBlob(
      b => b ? resolve(b) : reject(new Error('SmartImage: toBlob returned null')),
      'image/png',
    );
  });

  const blobUrl = URL.createObjectURL(blob);
  return { blobUrl, width: dstWidth, height: dstHeight };
}

// ─── Core load pipeline ────────────────────────────────────────────────────

const smartImageStyle = computed(() => ({
  '--smart-image-swap-ms': `${Math.max(props.swapDurationMs, 0)}ms`,
}));

let lastCandidatesSignature = '';

watch(
  () => props.candidates,
  candidates => {
    const signature = candidates.join('|');
    if (signature === lastCandidatesSignature) return;
    lastCandidatesSignature = signature;
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
    const oldCurrent = currentSrc.value;
    const oldPrevious = previousSrc.value;
    currentSrc.value = '';
    previousSrc.value = '';
    isSwapping.value = false;
    clearSwapResetHandle();
    // Теперь старые URL точно не отображаются
    safeRevokeBlobUrl(oldCurrent);
    safeRevokeBlobUrl(oldPrevious);
    return;
  }

  emit('resolutionStatus', { resolved: nextSrc.src, failed: [...failedCandidates.value] });
  if (nextSrc.src === currentSrc.value) {
    return;
  }

  emit('resolved', nextSrc);

  const prevUrl = currentSrc.value;
  previousSrc.value = prevUrl;
  isSwapping.value = previousSrc.value !== '';
  currentSrc.value = nextSrc.src;

  if (isSwapping.value && props.swapDurationMs > 0) {
    emit('swapStart', { duration: props.swapDurationMs });
  }

  scheduleSwapCleanup(prevUrl);
}

async function resolveFirstCandidate(
  candidates: string[],
  generation: number,
  blockedSrc?: string,
): Promise<SmartImageResolvedPayload | null> {
  for (const candidate of candidates) {
    if (!candidate || candidate === blockedSrc) {
      continue;
    }

    const metadata = await preloadCandidate(candidate, generation);
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

/**
 * Загружает и при необходимости ресемплирует один кандидат.
 *
 * Порядок:
 * 1. Стандартная загрузка через new Image() + decode()
 * 2. Если resampleTargetHeight задан И naturalHeight > targetH * 1.5 → Pica Lanczos3
 * 3. Возвращает SmartImageResolvedPayload с финальным src (blob: или оригинал)
 */
async function preloadCandidate(
  src: string,
  generation: number,
): Promise<SmartImageResolvedPayload | null> {
  // Шаг 1: стандартная загрузка
  const imageMetadata = await loadImage(src);
  if (!imageMetadata) return null;

  // После async операции всегда проверяем поколение
  if (generation !== loadGeneration.value) return null;

  const { img, naturalWidth, naturalHeight } = imageMetadata;

  // Шаг 2: нужен ли ресемплинг?
  const targetH = props.resampleTargetHeight;
  const shouldResample =
    targetH !== undefined &&
    targetH > 0 &&
    naturalHeight > targetH * 1.5; // только реальный downsampling

  if (!shouldResample) {
    return { src, naturalWidth, naturalHeight };
  }

  // Шаг 3: Pica Lanczos3
  try {
    const resampled = await picaResample(img, targetH!);

    if (generation !== loadGeneration.value) {
      // Компонент сменил кандидат пока мы ресемплировали — отзываем сразу
      URL.revokeObjectURL(resampled.blobUrl);
      return null;
    }

    registerBlobUrl(resampled.blobUrl);
    return {
      src: resampled.blobUrl,
      naturalWidth,
      naturalHeight,
    };
  } catch (err) {
    console.warn('[RenPy Player] SmartImage: pica resampling failed, using original.', err);
    // Fallback на оригинал — aliasing лучше чем отсутствие картинки
    if (generation !== loadGeneration.value) return null;
    return { src, naturalWidth, naturalHeight };
  }
}

/**
 * Загружает HTMLImageElement и вызывает decode().
 * Возвращает { img, naturalWidth, naturalHeight } или null при ошибке.
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

function handleDisplayError() {
  console.warn(`[RenPy Player] SmartImage display failed: ${currentSrc.value}`);
  const failed = currentSrc.value;
  void syncCurrentSrc(props.candidates, failed);
}

/**
 * Планирует очистку previousSrc после завершения CSS-свапа.
 * prevUrl передаётся явно чтобы не захватить замыкание на изменяемый ref.
 */
function scheduleSwapCleanup(prevUrl: string) {
  clearSwapResetHandle();

  if (!isSwapping.value) {
    // Свапа нет — prevUrl уже не нужен
    previousSrc.value = '';
    safeRevokeBlobUrl(prevUrl);
    return;
  }

  swapResetHandle.value = window.setTimeout(() => {
    previousSrc.value = '';
    isSwapping.value = false;
    swapResetHandle.value = null;
    // Анимация завершена — blob URL предыдущего кадра больше не нужен
    safeRevokeBlobUrl(prevUrl);
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
  // Отзываем все blob URL которые мы создали
  revokeAllOwnedBlobUrls();
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