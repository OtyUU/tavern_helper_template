<template>
  <div ref="root" class="renpy-player-settings__select" :class="{ 'is-open': isOpen }">
    <button
      type="button"
      class="text_pole renpy-player-settings__select-trigger"
      @click="toggle"
    >
      <span class="renpy-player-settings__select-value">{{ currentLabel }}</span>
      <svg class="renpy-player-settings__select-arrow" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" />
      </svg>
    </button>
    <ul v-if="isOpen" class="renpy-player-settings__select-dropdown" role="listbox">
      <li
        v-for="opt in options"
        :key="opt.value"
        role="option"
        :aria-selected="opt.value === modelValue"
        :class="{ 'is-active': opt.value === modelValue }"
        @click="select(opt.value)"
      >{{ opt.label }}</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
defineOptions({ inheritAttrs: false })

interface SelectOption {
  value: string
  label: string
}

const props = defineProps<{
  modelValue: string
  options: SelectOption[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const isOpen = ref(false)
const root = ref<HTMLElement | null>(null)

const currentLabel = computed(() => {
  const match = props.options.find(o => o.value === props.modelValue)
  return match ? match.label : props.modelValue
})

function toggle() {
  isOpen.value = !isOpen.value
}

function select(value: string) {
  emit('update:modelValue', value)
  isOpen.value = false
}

function onClickOutside(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) {
    isOpen.value = false
  }
}

onMounted(() => document.addEventListener('mousedown', onClickOutside, true))
onUnmounted(() => document.removeEventListener('mousedown', onClickOutside, true))
</script>

<style scoped lang="scss">
.renpy-player-settings__select {
  position: relative;
}

.renpy-player-settings__select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  text-align: left;
  cursor: pointer;
}

.renpy-player-settings__select-arrow {
  flex-shrink: 0;
  margin-left: 0.5em;
  opacity: 0.6;
  transition: transform 0.15s ease;
}

.is-open .renpy-player-settings__select-arrow {
  transform: rotate(180deg);
}

.renpy-player-settings__select-dropdown {
  position: absolute;
  z-index: 100;
  top: 100%;
  left: 0;
  right: 0;
  margin: 2px 0 0;
  padding: 0;
  list-style: none;
  border: 1px solid color-mix(in srgb, var(--SmartThemeBorderColor) 50%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--black30a) 92%, var(--SmartThemeBlurTintColor));
  backdrop-filter: blur(10px);
  overflow: hidden;
}

.renpy-player-settings__select-dropdown li {
  padding: 0.45em 0.7em;
  cursor: pointer;
  transition: background-color 0.1s ease;
}

.renpy-player-settings__select-dropdown li:hover {
  background: color-mix(in srgb, var(--white30a) 8%, transparent);
}

.renpy-player-settings__select-dropdown li.is-active {
  font-weight: 600;
}
</style>
