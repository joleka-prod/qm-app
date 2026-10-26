import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { useOfflineState } from '../lib/offline'
import { supabase } from '../lib/supabase'
import { OfflineBar } from './OfflineBar'
import { ROLE_LABEL, canUseCrm, displayName, isPlannerRole } from '../lib/types'

export function Layout() {
  const { profile } = useAuth()
  const offline = useOfflineState()
  const path = useLocation().pathname
  const isPlanner = isPlannerRole(profile?.role)
  // Kalender und die Startseite der Planer (mit Spalte "Dringender Handlungsbedarf") nutzen die volle Breite
  const wide = path === '/kalender' || path === '/fenster' || (isPlanner && (path === '/' || path === '/tickets'))
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">JOLEKA - Einfach besonders!</NavLink>
        <nav>
          {canUseCrm(profile?.role) && <NavLink to="/kunden">Kunden</NavLink>}
          {canUseCrm(profile?.role) && <NavLink to="/bauvorhaben">Bauvorhaben</NavLink>}
          {profile?.role === 'monteur' ? (
            <>
              <NavLink to="/" end>Mein Kalender</NavLink>
              <NavLink to="/tickets">Aufträge</NavLink>
            </>
          ) : (
            <NavLink to="/" end>Aufträge</NavLink>
          )}
          {isPlanner && <NavLink to="/kalender">Kalender</NavLink>}
          <NavLink to="/zeiterfassung">Zeiterfassung</NavLink>
          {profile?.role === 'admin' && <NavLink to="/fenster">Fenster</NavLink>}
          {profile?.role === 'admin' && <NavLink to="/artikel">Artikel</NavLink>}
          {profile?.role === 'admin' && <NavLink to="/benutzer">Benutzer</NavLink>}
          <NavLink to="/profil" title={profile ? ROLE_LABEL[profile.role] : ''}>
            {displayName(profile)}
          </NavLink>
          <button
            className="link"
            onClick={() =>
              (offline.pending === 0 ||
                confirm(`Es warten noch ${offline.pending} Änderungen auf Übertragung. Sie werden übertragen, sobald du dich wieder anmeldest. Trotzdem abmelden?`)) &&
              supabase.auth.signOut()
            }
          >
            Abmelden
          </button>
        </nav>
      </header>
      <OfflineBar />
      <main className={path === '/kalender' ? 'content full' : wide ? 'content wide' : 'content'}>
        <Outlet />
      </main>
      <footer className="app-version">Version {__BUILD__}</footer>
    </div>
  )
}
