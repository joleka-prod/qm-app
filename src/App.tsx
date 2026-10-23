import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import { Layout } from './components/Layout'
import { configMissing } from './lib/supabase'
import { Articles } from './pages/Articles'
import { InstallerCalendar } from './pages/InstallerCalendar'
import { Login } from './pages/Login'
import { NewTicket } from './pages/NewTicket'
import { PlanningCalendar } from './pages/PlanningCalendar'
import { ProfilePage } from './pages/ProfilePage'
import { SetPassword } from './pages/SetPassword'
import { TicketDetail } from './pages/TicketDetail'
import { TicketList } from './pages/TicketList'
import { Timesheet } from './pages/Timesheet'
import { Users } from './pages/Users'

function Routed() {
  const { session, profile, loading, needsPassword } = useAuth()

  if (loading) return <p className="center muted">Lädt…</p>
  if (!session) return <Login />
  if (needsPassword) return <SetPassword />
  if (!profile) return <p className="center muted">Profil wird geladen…</p>
  if (!profile.active) return <p className="center">Dein Zugang ist deaktiviert. Bitte wende dich an die Verwaltung.</p>

  const isPlanner = profile.role === 'admin' || profile.role === 'teamleiter'

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={profile.role === 'monteur' ? <InstallerCalendar /> : <TicketList />} />
        <Route path="tickets" element={<TicketList />} />
        {isPlanner && <Route path="kalender" element={<PlanningCalendar />} />}
        {isPlanner && <Route path="monteur/:id" element={<InstallerCalendar />} />}
        <Route path="neu" element={<NewTicket />} />
        <Route path="ticket/:id" element={<TicketDetail />} />
        <Route path="profil" element={<ProfilePage />} />
        <Route path="stundenzettel" element={<Timesheet />} />
        {profile.role === 'admin' && <Route path="benutzer" element={<Users />} />}
        {profile.role === 'admin' && <Route path="artikel" element={<Articles />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  if (configMissing) {
    return (
      <p className="center">
        Supabase ist nicht konfiguriert. Bitte <code>VITE_SUPABASE_URL</code> und <code>VITE_SUPABASE_ANON_KEY</code> setzen.
      </p>
    )
  }
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routed />
      </BrowserRouter>
    </AuthProvider>
  )
}
