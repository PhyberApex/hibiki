import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastLink {
  label: string
  url: string
}

export interface Toast {
  id: number
  type: ToastType
  text: string
  key?: string
  link?: ToastLink
}

export interface ToastInput {
  type: ToastType
  text: string
  /** `null` keeps the toast until it is dismissed. */
  durationMs?: number | null
  /** A later toast with the same key replaces the earlier one in place instead of stacking. */
  key?: string
  /** Opened in the system browser from the toast. */
  link?: ToastLink
  /** Runs when the GM dismisses the toast, not when it times out or makes room for a newer one. */
  onDismiss?: () => void
}

export const MAX_VISIBLE_TOASTS = 3
export const DEFAULT_TOAST_DURATION_MS = 4000

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Toast[]>([])
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  const dismissHandlers = new Map<number, () => void>()
  let nextId = 1

  function dismiss(id: number) {
    const timer = timers.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.delete(id)
    }
    dismissHandlers.delete(id)
    toasts.value = toasts.value.filter(t => t.id !== id)
  }

  function dismissByUser(id: number) {
    const onDismiss = dismissHandlers.get(id)
    dismiss(id)
    onDismiss?.()
  }

  function startTimer(id: number, durationMs: number | null) {
    if (durationMs !== null)
      timers.set(id, setTimeout(dismiss, durationMs, id))
  }

  function show({ type, text, durationMs = DEFAULT_TOAST_DURATION_MS, key, link, onDismiss }: ToastInput): number {
    // Warnings and errors must reach hibiki.log; the main process captures renderer warn/error.
    if (type === 'error')
      console.error(`[toast] ${text}`)
    else if (type === 'warning')
      console.warn(`[toast] ${text}`)

    const existing = key ? toasts.value.find(t => t.key === key) : undefined
    if (existing) {
      clearTimeout(timers.get(existing.id))
      timers.delete(existing.id)
      Object.assign(existing, { type, text, link })
      if (onDismiss)
        dismissHandlers.set(existing.id, onDismiss)
      else
        dismissHandlers.delete(existing.id)
      startTimer(existing.id, durationMs)
      return existing.id
    }

    const id = nextId++
    toasts.value.push({ id, type, text, key, link })
    if (onDismiss)
      dismissHandlers.set(id, onDismiss)
    // Oldest toast makes room once more than the visible cap are queued.
    while (toasts.value.length > MAX_VISIBLE_TOASTS)
      dismiss(toasts.value[0].id)
    startTimer(id, durationMs)
    return id
  }

  return { toasts, show, dismiss, dismissByUser }
})
