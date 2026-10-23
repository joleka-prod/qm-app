import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL, displayName } from '../lib/types'

export function Layout() {
  const { profile } = useAuth()
  const wide = useLocation().pathname === '/kalender'
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">JOLEKA Service Dashboard</NavLink>
        <nav>
          {profile?.role === 'monteur' ? (
            <>
              <NavLink to="/" end>Mein Kalender</NavLink>
              <NavLink to="/tickets">Service-Aufträge</NavLink>
            </>
          ) : (
            <NavLink to="/" end>Service-Aufträge</NavLink>
          )}
          {(profile?.role === 'admin' || profile?.role === 'teamleiter') && <NavLink to="/kalender">Kalender</NavLink>}
          {profile?.role === 'admin' && <NavLink to="/benutzer">Benutzer</NavLink>}
          <NavLink to="/profil" title={profile ? ROLE_LABEL[profile.role] : ''}>
            {displayName(profile)}
          </NavLink>
          <button className="link" onClick={() => supabase.auth.signOut()}>Abmelden</button>
        </nav>
      </header>
      <main className={wide ? 'content wide' : 'content'}>
        <Outlet />
      </main>
    </div>
  )
}
