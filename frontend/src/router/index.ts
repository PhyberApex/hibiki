import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'welcome',
      component: () => import('../views/WelcomeView.vue'),
    },
    {
      path: '/media',
      name: 'media',
      component: () => import('../views/MediaManagementView.vue'),
    },
    {
      path: '/scenes',
      name: 'scenes',
      component: () => import('../views/SceneView.vue'),
    },
    {
      path: '/scenes/:id',
      name: 'scene',
      component: () => import('../views/SceneView.vue'),
    },
    {
      path: '/browser',
      name: 'browser',
      component: () => import('../views/BrowserView.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
    },
    {
      path: '/about',
      name: 'about',
      component: () => import('../views/AboutView.vue'),
    },
  ],
})

export default router
