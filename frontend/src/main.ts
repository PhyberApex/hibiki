import { createPinia } from 'pinia'

import { createApp } from 'vue'
import App from './App.vue'
import { installLocalSink } from './audio/local-sink'
import { installOutputDevice } from './audio/output-device'

import router from './router'
import { useToastStore } from './stores/toast'
import './assets/main.css'

const app = createApp(App)

// The main process mirrors renderer console errors into hibiki.log, so
// anything that would otherwise die silently in the renderer surfaces there.
app.config.errorHandler = (err, _instance, info) => {
  console.error(`[renderer] Vue error during ${info}:`, err)
}
window.addEventListener('unhandledrejection', (event) => {
  console.error('[renderer] Unhandled promise rejection:', event.reason)
})
window.addEventListener('error', (event) => {
  console.error('[renderer] Uncaught error:', event.error ?? event.message)
})

// The Local Target's speakers: plays the backend mix whenever the main process sends it.
installLocalSink()

app.use(createPinia())
app.use(router)

// The Local Target's Output Device: resolved against connected devices, with one warning per absence.
installOutputDevice(label => useToastStore().show({ type: 'warning', text: `${label} not found, playing through the system default` }))

app.mount('#app')
