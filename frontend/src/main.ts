import { createPinia } from 'pinia'

import { createApp } from 'vue'
import App from './App.vue'

import router from './router'
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

app.use(createPinia())
app.use(router)

app.mount('#app')
