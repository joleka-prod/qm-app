import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isTestSystem } from './lib/env'
import { registerSW } from 'virtual:pwa-register'

// Neue Versionen sofort übernehmen: beim Öffnen, beim Zurückkehren in die App und stündlich nachsehen
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return
    setInterval(() => reg.update(), 60 * 60 * 1000)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update()
    })
  },
})
void updateSW

if (isTestSystem) document.title = `TEST – ${document.title}`

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isTestSystem && <div className="test-banner">TESTSYSTEM – Änderungen hier wirken nicht im Livesystem</div>}
    <App />
  </StrictMode>,
)
