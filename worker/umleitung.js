// Alte Adresse qm-app.fabian-rieder.workers.dev: leitet auf 360.joleka.de weiter.
// /sw.js liefert einen Service Worker, der sich selbst abmeldet. Sonst würde die auf
// dem Handy installierte App weiter die alte, zwischengespeicherte Version anzeigen.
const ZIEL = 'https://360.joleka.de'

const ABMELDEN = `
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.registration.unregister()
    const fenster = await self.clients.matchAll({ type: 'window' })
    for (const f of fenster) f.navigate(f.url)
  })())
})
`

export default {
  fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/sw.js') {
      return new Response(ABMELDEN, {
        headers: { 'content-type': 'text/javascript', 'cache-control': 'no-store' },
      })
    }
    return Response.redirect(ZIEL + url.pathname + url.search, 302)
  },
}
