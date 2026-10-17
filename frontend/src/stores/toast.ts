import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: number
  type: ToastType
  text: string
  key?: string
}

export interface ToastInput {
  type: ToastType
  text: string
  durationMs?: number
  /** A later toast with the same key replaces the earlier one in place instead of stacking. */
  key?: string
}

export const MAX_VISIBLE_TOASTS = 3
export const DEFAULT_TOAST_DURATION_MS = 4000

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Toast[]>([])
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  let nextId = 1

  function dismiss(id: number) {
    const timer = timers.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.delete(id)
    }
    toasts.value = toasts.value.filter(t => t.id !== id)
  }

  function show({ type, text, durationMs = DEFAULT_TOAST_DURATION_MS, key }: ToastInput): number {
    // Warnings and errors must reach hibiki.log; the main process captures renderer warn/error.
    if (type === 'error')
      console.error(`[toast] ${text}`)
    else if (type === 'warning')
      console.warn(`[toast] ${text}`)

    const existing = key ? toasts.value.find(t => t.key === key) : undefined
    if (existing) {
      clearTimeout(timers.get(existing.id))
      Object.assign(existing, { type, text })
      timers.set(existing.id, setTimeout(dismiss, durationMs, existing.id))
      return existing.id
    }

    const id = nextId++
    toasts.value.push({ id, type, text, key })
    // Oldest toast makes room once more than the visible cap are queued.
    while (toasts.value.length > MAX_VISIBLE_TOASTS)
      dismiss(toasts.value[0].id)
    timers.set(id, setTimeout(dismiss, durationMs, id))
    return id
  }

  return { toasts, show, dismiss }
})
