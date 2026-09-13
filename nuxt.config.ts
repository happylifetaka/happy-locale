export default defineNuxtConfig({
  modules: ['@pinia/nuxt'],
  compatibilityDate: '2025-07-15',
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  runtimeConfig: {
    public: {
      translationEndpointEnabled: 'true',
    },
  },
  typescript: {
    strict: true,
    typeCheck: true,
  },
  nitro: {
    publicAssets: [
      {
        baseURL: '/ocr/worker',
        dir: new URL('./node_modules/tesseract.js/dist', import.meta.url).pathname,
      },
      {
        baseURL: '/ocr/core',
        dir: new URL('./node_modules/tesseract.js-core', import.meta.url).pathname,
      },
      {
        baseURL: '/ocr/lang',
        dir: new URL(
          './node_modules/@tesseract.js-data/eng/4.0.0_best_int',
          import.meta.url,
        ).pathname,
      },
    ],
  },
})
