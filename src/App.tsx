import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import { Layout } from './components/Layout'
import { configMissing } from './lib/supabase'
import { canSeePersonnel, canUseCrm, isPlannerRole } from './lib/types'
import { Articles } from './pages/Articles'
import { CustomerDetail } from './pages/CustomerDetail'
import { Customers } from './pages/Customers'
import { ProjectDetail } from './pages/ProjectDetail'
import { Projects } from './pages/Projects'
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
import { Windows } from './pages/Windows'
import { NfcTest } from './pages/NfcTest'
import { Terminal } from './pages/Terminal'
import { Personnel } from './pages/Personnel'
import { PersonnelDetail } from './pages/PersonnelDetail'
import { EmployeeImport } from './pages/EmployeeImport'

function Routed() {
  const { session, profile, loading, needsPassword } = useAuth()

  // Stempel-Terminal: eigenes Vollbild ohne Anmeldung (weist sich mit dem Geräteschlüssel aus)
  if (window.location.pathname === '/terminal') return <Terminal />
  // NFC-Test ist ohne Anmeldung erreichbar (liest nur den Chip, keine Daten)
  if (window.location.pathname === '/nfc-test')
    return (
      <main className="content">
        <NfcTest />
      </main>
    )
  if (loading) return <p className="center muted">Lädt…</p>
  if (!session) return <Login />
  if (needsPassword) return <SetPassword />
  if (!profile) return <p className="center muted">Profil wird geladen…</p>
  if (!profile.active) return <p className="center">Dein Zugang ist deaktiviert. Bitte wende dich an die Verwaltung.</p>

  const isPlanner = isPlannerRole(profile.role)

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={profile.role === 'monteur' ? <InstallerCalendar /> : <TicketList />} />
        <Route path="tickets" element={<TicketList />} />
        {isPlanner && <Route path="kalender" element={<PlanningCalendar />} />}
        {isPlanner && <Route path="monteur/:id" element={<InstallerCalendar />} />}
        <Route path="neu" element={<NewTicket />} />
        <Route path="ticket/:id" element={<TicketDetail />} />
        {canUseCrm(profile.role) && <Route path="kunden" element={<Customers />} />}
        {canUseCrm(profile.role) && <Route path="kunden/:id" element={<CustomerDetail />} />}
        {canUseCrm(profile.role) && <Route path="bauvorhaben" element={<Projects />} />}
        {canUseCrm(profile.role) && <Route path="bauvorhaben/:id" element={<ProjectDetail />} />}
        <Route path="profil" element={<ProfilePage />} />
        <Route path="zeiterfassung" element={<Timesheet />} />
        <Route path="stundenzettel" element={<Navigate to="/zeiterfassung" replace />} />
        {profile.role === 'admin' && <Route path="benutzer" element={<Users />} />}
        {canSeePersonnel(profile) && <Route path="personal" element={<Personnel />} />}
        {canSeePersonnel(profile) && <Route path="personal/:id" element={<PersonnelDetail />} />}
        {profile.role === 'admin' && <Route path="personal/import" element={<EmployeeImport />} />}
        {profile.role === 'admin' && <Route path="artikel" element={<Articles />} />}
        {profile.role === 'admin' && <Route path="fenster" element={<Windows />} />}
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
