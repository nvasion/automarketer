import { Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import Sidebar from './components/Sidebar'
import { Lockup } from './components/Brand'
import { ThemeSwitch } from './components/Theme'
import LandingPage from './pages/public/LandingPage'
import HowItWorksPage from './pages/public/HowItWorksPage'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import CampaignList from './pages/CampaignList'
import CampaignDetail from './pages/CampaignDetail'
import CreateCampaign from './pages/CreateCampaign'
import EditCampaign from './pages/EditCampaign'
import Scheduler from './pages/Scheduler'
import Analytics from './pages/Analytics'
import Settings from './pages/Settings'
import './App.css'

/**
 * Layout wrapper for authenticated pages, the TynHub console frame shared with
 * Routini: slate masthead with the lockup, left nav, then the page.
 */
function AppShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  return (
    <div className="shell">
      <header className="am-header">
        <Link className="brand" to="/" aria-label="AutoMarketer home">
          <Lockup size={34} sub="AI MARKETING · ON TYNHUB" />
        </Link>
        <span className="am-header-spacer" />
        <ThemeSwitch />
        <button type="button" className="btn primary" onClick={() => navigate('/create')}>
          New campaign
        </button>
      </header>
      <div className="shell-body">
        <Sidebar />
        <main className="shell-main" id="main">
          {children}
        </main>
      </div>
    </div>
  )
}

/** "/" is the dashboard when signed in and the public front page otherwise. */
function HomeRoute() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <LandingPage />
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  )
}

/** Redirect already-authenticated users away from the public auth pages. */
function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (user) return <Navigate to="/" replace />
  return <>{children}</>
}

function App() {
  return (
    <Routes>
      {/* ── Public routes ── */}
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <Login />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/register"
        element={
          <PublicOnlyRoute>
            <Register />
          </PublicOnlyRoute>
        }
      />

      <Route path="/how-it-works" element={<HowItWorksPage />} />

      {/* ── Protected routes ── */}
      <Route path="/" element={<HomeRoute />} />
      <Route
        path="/campaigns"
        element={
          <ProtectedRoute>
            <AppShell>
              <CampaignList />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/campaigns/:id"
        element={
          <ProtectedRoute>
            <AppShell>
              <CampaignDetail />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/campaigns/:id/edit"
        element={
          <ProtectedRoute>
            <AppShell>
              <EditCampaign />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/create"
        element={
          <ProtectedRoute>
            <AppShell>
              <CreateCampaign />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/scheduler"
        element={
          <ProtectedRoute>
            <AppShell>
              <Scheduler />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/analytics"
        element={
          <ProtectedRoute>
            <AppShell>
              <Analytics />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <AppShell>
              <Settings />
            </AppShell>
          </ProtectedRoute>
        }
      />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
