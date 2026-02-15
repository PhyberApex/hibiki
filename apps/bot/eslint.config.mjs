// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu({
  typescript: true,
  ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'jest.config.js'],
  rules: {
    'node/prefer-global/process': 'off',
    'node/prefer-global/buffer': 'off',
  },
})
