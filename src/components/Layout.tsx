import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL, displayName } from '../lib/types'

export function Layout() {
  const { profile } = useAuth()
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">QM-Tickets</NavLink>
        <nav>
          <NavLink to="/" end>Tickets</NavLink>
          {profile?.role === 'admin' && <NavLink to="/benutzer">Benutzer</NavLink>}
          <NavLink to="/profil" title={profile ? ROLE_LABEL[profile.role] : ''}>
            {displayName(profile)}
          </NavLink>
          <button className="link" onClick={() => supabase.auth.signOut()}>Abmelden</button>
        </nav>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
