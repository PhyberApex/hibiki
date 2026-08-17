import { ref } from 'vue'

/**
 * Reactive set of ids that are "flashing": each id stays active for
 * `durationMs` after its latest trigger, then drops out on its own.
 */
export function useFlashSet(durationMs = 500) {
  const active = ref(new Set<string>())
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  function trigger(id: string) {
    const pending = timers.get(id)
    if (pending)
      clearTimeout(pending)
    active.value.add(id)
    timers.set(id, setTimeout(() => {
      active.value.delete(id)
      timers.delete(id)
    }, durationMs))
  }

  function has(id: string): boolean {
    return active.value.has(id)
  }

  return { has, trigger }
}
