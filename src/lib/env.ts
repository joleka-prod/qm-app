// Testsystem: Build-Variable VITE_APP_ENV=test (nur im Cloudflare-Projekt qm-app-test gesetzt)
export const isTestSystem = import.meta.env.VITE_APP_ENV === 'test'
