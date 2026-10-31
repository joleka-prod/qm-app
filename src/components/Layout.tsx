import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { OfflineBar } from './OfflineBar'
import { ROLE_LABEL, canSeePersonnel, canUseCrm, displayName, isPlannerRole } from '../lib/types'

export function Layout() {
  const { profile } = useAuth()
  const path = useLocation().pathname
  const isPlanner = isPlannerRole(profile?.role)
  // Kalender und die Startseite der Planer (mit Spalte "Dringender Handlungsbedarf") nutzen die volle Breite
  const wide = path === '/kalender' || path === '/fenster' || path.startsWith('/personal') || (isPlanner && (path === '/' || path === '/tickets'))
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <img src="/favicon.svg" alt="" className="brand-logo" />
          JOLEKA 360°
        </NavLink>
        <NavLink to="/profil" className="topbar-user" title={profile ? `Mein Profil · ${ROLE_LABEL[profile.role]}` : 'Mein Profil'}>
          {displayName(profile)}
        </NavLink>
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
          {canSeePersonnel(profile) && <NavLink to="/personal">Personal</NavLink>}
          {profile?.role === 'admin' && <NavLink to="/fenster">Fenster</NavLink>}
          {profile?.role === 'admin' && <NavLink to="/artikel">Artikel</NavLink>}
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
