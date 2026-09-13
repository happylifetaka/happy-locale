import antfu from '@antfu/eslint-config'

export default antfu({
  ignores: ['.nuxt/**', '.output/**', 'node_modules/**'],
  typescript: true,
  vue: true,
})
