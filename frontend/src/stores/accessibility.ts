import { defineStore } from 'pinia'
import { computed, ref, watchEffect } from 'vue'
import { fetchAccessibilitySettings, updateAccessibilitySettings } from '@/api/config'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function watchSystemReducedMotion(onChange: (matches: boolean) => void): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
    return false
  const media = window.matchMedia(REDUCED_MOTION_QUERY)
  media.addEventListener('change', event => onChange(event.matches))
  return media.matches
}

export const useAccessibilityStore = defineStore('accessibility', () => {
  const luminancePulses = ref(true)
  const reduceMotionOverride = ref<boolean | null>(null)
  const systemReducesMotion = ref(watchSystemReducedMotion((matches) => {
    systemReducesMotion.value = matches
  }))

  const followsSystemMotion = computed(() => reduceMotionOverride.value === null)
  const reduceMotion = computed(() => reduceMotionOverride.value ?? systemReducesMotion.value)

  if (typeof document !== 'undefined') {
    watchEffect(() => {
      const root = document.documentElement.classList
      root.toggle('pulses-off', !luminancePulses.value)
      root.toggle('reduce-motion', reduceMotion.value)
      root.toggle('allow-motion', reduceMotionOverride.value === false)
    })
  }

  async function load() {
    try {
      const settings = await fetchAccessibilitySettings()
      luminancePulses.value = settings.luminancePulses
      reduceMotionOverride.value = settings.reduceMotion
    }
    catch {
      // Expected when running outside Electron (e.g. tests or Vite dev)
    }
  }

  function persist() {
    return updateAccessibilitySettings({
      luminancePulses: luminancePulses.value,
      reduceMotion: reduceMotionOverride.value,
    })
  }

  async function setLuminancePulses(enabled: boolean) {
    luminancePulses.value = enabled
    await persist()
  }

  async function setReduceMotion(override: boolean | null) {
    reduceMotionOverride.value = override
    await persist()
  }

  return {
    luminancePulses,
    reduceMotionOverride,
    systemReducesMotion,
    followsSystemMotion,
    reduceMotion,
    load,
    setLuminancePulses,
    setReduceMotion,
  }
})
