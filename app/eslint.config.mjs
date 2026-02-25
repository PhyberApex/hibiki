// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu({
  vue: true,
  typescript: true,
  ignores: ['dist/**', 'web-dist/**', 'coverage/**', 'frontend/dist/**', 'node_modules/**', 'jest.config.js'],
  rules: {
    'node/prefer-global/process': 'off',
    'node/prefer-global/buffer': 'off',
  },
})
