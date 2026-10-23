import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { parseUserDetailsFromEmail } from '../utils/userDisplay'
import { PLATFORM_CONFIGS } from '../data/sampleData'
import { loadAIConfig, saveAIConfig, syncAiPrefsFromServer, validateEndpointUrl } from '../config/aiConfig'
import type { AIConfig, ProviderConfig } from '../config/aiConfig'
import type { PlatformConfig } from '../types'
import PlatformBadge from '../components/PlatformBadge'
import PlatformConnectionModal from '../components/PlatformConnectionModal'
import TynhubAccountCard from '../components/TynhubAccountCard'
import { fetchConnectedPlatforms, disconnectPlatform } from '../services/platformConfigService'
import {
  fetchLinkedInPages,
  loadSelectedLinkedInPage,
  saveSelectedLinkedInPage,
} from '../services/linkedinService'
import type { LinkedInPage } from '../services/linkedinService'

type SettingsTab = 'profile' | 'platforms' | 'ai' | 'notifications'

const NOTIFICATIONS: { id: string; title: string; desc: string; defaultOn: boolean }[] = [
  { id: 'postPublished', title: 'Post Published', desc: 'Get notified when a post goes live', defaultOn: true },
  { id: 'engagementMilestones', title: 'Engagement Milestones', desc: 'Alerts when posts reach 1k, 5k, 10k engagements', defaultOn: true },
  { id: 'generationComplete', title: 'Generation Complete', desc: 'When AI finishes generating your campaign posts', defaultOn: true },
  { id: 'weeklyDigest', title: 'Weekly Digest', desc: 'Summary of performance every Monday morning', defaultOn: false },
  { id: 'platformErrors', title: 'Platform Errors', desc: 'Alerts when a post fails to publish', defaultOn: true },
]

const DEFAULT_NOTIFICATIONS: Record<string, boolean> = Object.fromEntries(
  NOTIFICATIONS.map(({ id, defaultOn }) => [id, defaultOn])
)

const TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: 'profile', label: 'Profile', icon: '👤' },
  { id: 'platforms', label: 'Connected Platforms', icon: '🔗' },
  { id: 'ai', label: 'AI Settings', icon: '✨' },
  { id: 'notifications', label: 'Notifications', icon: '🔔' },
]

const CONNECTED: Record<string, boolean> = {
  linkedin: false,
  twitter: false,
  reddit: false,
  facebook: false,
  instagram: false,
  bluesky: false,
}

const TONES = [
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'excited', label: 'Excited' },
  { value: 'informative', label: 'Informative' },
]

const EMOJI_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'minimal', label: 'Minimal (1–2 per post)' },
  { value: 'moderate', label: 'Moderate (3–5 per post)' },
  { value: 'heavy', label: 'Heavy (emoji-rich)' },
]

// ─── Toggle component ─────────────────────────────────────────────────────────

function Toggle({ on, onChange, testId }: { on: boolean; onChange: () => void; testId?: string }) {
  return (
    <div
      data-testid={testId ? `toggle-track-${testId}` : undefined}
      onClick={onChange}
      style={{
        width: '44px',
        height: '24px',
        borderRadius: '12px',
        background: on ? 'var(--primary)' : 'var(--line)',
        cursor: 'pointer',
        position: 'relative',
        transition: 'background 0.2s',
        flexShrink: 0,
      }}
    >
      <div
        data-testid={testId ? `toggle-thumb-${testId}` : undefined}
        style={{
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          background: 'var(--panel)',
          position: 'absolute',
          top: '3px',
          left: on ? '23px' : '3px',
          transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}
      />
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

function Settings() {
  const { user } = useAuth()
  const { firstName, lastName, initial } = user
    ? parseUserDetailsFromEmail(user.email)
    : { firstName: '', lastName: '', initial: '?' }

  const [activeTab, setActiveTab] = useState<SettingsTab>('profile')
  const [connections, setConnections] = useState(CONNECTED)
  const [connectingPlatform, setConnectingPlatform] = useState<PlatformConfig | null>(null)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [notifications, setNotifications] = useState<Record<string, boolean>>(DEFAULT_NOTIFICATIONS)

  // LinkedIn page/identity picker
  const [linkedInPages, setLinkedInPages] = useState<LinkedInPage[]>([])
  const [linkedInPagesLoading, setLinkedInPagesLoading] = useState(false)
  const [linkedInPagesError, setLinkedInPagesError] = useState<string | null>(null)
  const [selectedLinkedInPage, setSelectedLinkedInPage] = useState<LinkedInPage | null>(() =>
    user ? loadSelectedLinkedInPage(user.id) : null
  )

  // AI config — loaded from localStorage on mount, then refreshed from the
  // server so generation preferences saved on another browser show up here.
  const [aiConfig, setAiConfig] = useState<AIConfig>(loadAIConfig)
  const [showApiKey, setShowApiKey] = useState(false)

  useEffect(() => {
    let cancelled = false
    void syncAiPrefsFromServer()
      .then(() => {
        if (!cancelled) setAiConfig(loadAIConfig())
      })
      .catch(() => {
        /* non-fatal — keep locally-loaded config */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const [showCustomApiKey, setShowCustomApiKey] = useState(false)
  const [endpointUrlError, setEndpointUrlError] = useState<string | null>(null)

  // Load real connection state from the server so connected platforms stay
  // connected across reloads (they were previously reset to all-disconnected).
  useEffect(() => {
    let cancelled = false
    fetchConnectedPlatforms()
      .then((status) => {
        if (!cancelled) setConnections((prev) => ({ ...prev, ...status }))
      })
      .catch(() => {
        /* non-fatal — leave the default disconnected state */
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Load LinkedIn pages when LinkedIn is connected. Re-runs when connection state
  // changes (e.g. just connected) or when the user switches to the platforms tab.
  useEffect(() => {
    if (!connections.linkedin || activeTab !== 'platforms') return
    let cancelled = false
    setLinkedInPagesLoading(true)
    setLinkedInPagesError(null)
    fetchLinkedInPages()
      .then((pages) => {
        if (cancelled) return
        setLinkedInPages(pages)
        // If the saved selection is no longer in the list, clear it
        setSelectedLinkedInPage((prev) => {
          if (!prev) return null
          return pages.find((p) => p.urn === prev.urn) ?? null
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLinkedInPagesError(
          err instanceof Error ? err.message : 'Could not load LinkedIn pages.'
        )
      })
      .finally(() => {
        if (!cancelled) setLinkedInPagesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [connections.linkedin, activeTab])

  const toggleNotification = (id: string) => {
    setNotifications((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handleSave = () => {
    // Validate custom endpoint URL before saving
    if (activeTab === 'ai' && aiConfig.provider === 'custom') {
      const urlErr = validateEndpointUrl(aiConfig.providers.custom.baseUrl)
      if (urlErr) {
        setEndpointUrlError(urlErr)
        return
      }
    }
    setEndpointUrlError(null)

    if (activeTab === 'ai') {
      const result = saveAIConfig(aiConfig)
      if (!result.success) {
        setSaveError(result.error ?? 'Settings could not be saved locally.')
        return
      }
    }
    setSaveError(null)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const openConnectModal = (platform: PlatformConfig) => {
    setConnectingPlatform(platform)
  }

  const handleConnectComplete = (platformId: string) => {
    setConnections((prev) => ({ ...prev, [platformId]: true }))
    // Pages will be loaded by the useEffect that watches connections.linkedin
  }

  const handleDisconnect = (platformId: string) => {
    // Optimistically flip to disconnected, then delete the token server-side.
    // Revert on failure so the UI keeps matching real state.
    setConnections((prev) => ({ ...prev, [platformId]: false }))
    disconnectPlatform(platformId).catch(() => {
      setConnections((prev) => ({ ...prev, [platformId]: true }))
    })
    // Clear LinkedIn page selection when disconnecting
    if (platformId === 'linkedin' && user) {
      saveSelectedLinkedInPage(user.id, null)
      setSelectedLinkedInPage(null)
      setLinkedInPages([])
    }
  }

  const handleLinkedInPageChange = (urn: string) => {
    const page = linkedInPages.find((p) => p.urn === urn) ?? null
    setSelectedLinkedInPage(page)
    if (user) saveSelectedLinkedInPage(user.id, page)
  }

  // Helpers for updating nested AI config
  const updateProvider = (provider: keyof AIConfig['providers'], patch: Partial<ProviderConfig>) =>
    setAiConfig((prev) => ({
      ...prev,
      providers: {
        ...prev.providers,
        [provider]: { ...prev.providers[provider], ...patch },
      },
    }))

  const updateDefaults = (patch: Partial<AIConfig['defaults']>) =>
    setAiConfig((prev) => ({ ...prev, defaults: { ...prev.defaults, ...patch } }))

  // Clear URL error when user edits the field
  const handleCustomBaseUrlChange = (value: string) => {
    setEndpointUrlError(null)
    updateProvider('custom', { baseUrl: value })
  }

  // ── Shared styles ───────────────────────────────────────────────────────────

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '9px 12px',
    borderRadius: '8px',
    border: '1px solid var(--line)',
    fontSize: '14px',
    color: 'var(--ink)',
    outline: 'none',
    background: 'var(--panel)',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--ink-2)',
    marginBottom: '6px',
  }

  const sectionStyle: React.CSSProperties = { marginBottom: '20px' }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '32px' }}>
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '30px', fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>
          Settings
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '14px' }}>
          Manage your account, platforms, and AI preferences.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '24px' }}>
        {/* Tab nav */}
        <div
          style={{
            background: 'var(--panel)',
            borderRadius: '12px',
            border: '1px solid var(--line)',
            padding: '12px',
            height: 'fit-content',
          }}
        >
          {TABS.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '9px 10px',
                borderRadius: '8px',
                border: 'none',
                background: activeTab === id ? 'var(--accent-soft)' : 'transparent',
                color: activeTab === id ? 'var(--accent)' : 'var(--muted)',
                fontSize: '13px',
                fontWeight: activeTab === id ? 600 : 400,
                cursor: 'pointer',
                marginBottom: '2px',
                textAlign: 'left',
              }}
            >
              <span>{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div
          style={{
            background: 'var(--panel)',
            borderRadius: '12px',
            border: '1px solid var(--line)',
            padding: '28px',
          }}
        >
          {/* ── Profile Tab ──────────────────────────────────────────────── */}
          {activeTab === 'profile' && (
            <div>
              <h2 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>
                Profile Settings
              </h2>
              <p style={{ color: 'var(--muted)', fontSize: '13px', marginBottom: '24px' }}>
                Update your account information.
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
                <div
                  style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '50%',
                    background: 'var(--primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--on-primary)',
                    fontSize: '24px',
                    fontWeight: 700,
                  }}
                >
                  {initial}
                </div>
                <div>
                  <button
                    style={{
                      background: 'var(--sunken)',
                      border: '1px solid var(--line)',
                      borderRadius: '8px',
                      padding: '7px 14px',
                      fontSize: '13px',
                      color: 'var(--ink-2)',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    Change Avatar
                  </button>
                  <p style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
                    JPG, PNG max 2 MB
                  </p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <label style={labelStyle}>First Name</label>
                  <input key={`fn-${user?.id}`} style={inputStyle} defaultValue={firstName} />
                </div>
                <div>
                  <label style={labelStyle}>Last Name</label>
                  <input key={`ln-${user?.id}`} style={inputStyle} defaultValue={lastName} />
                </div>
              </div>
              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>Email Address</label>
                <input key={`em-${user?.id}`} style={inputStyle} defaultValue={user?.email ?? ''} />
              </div>
              <div style={{ marginBottom: '24px' }}>
                <label style={labelStyle}>Company / Brand Name</label>
                <input style={inputStyle} defaultValue="AutoMarketer" />
              </div>

              {/* Hosted AutoMarketer only: renders nothing unless TynHub sign-in is offered. */}
              <TynhubAccountCard />
            </div>
          )}

          {/* ── Platforms Tab ─────────────────────────────────────────────── */}
          {activeTab === 'platforms' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                <h2 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--ink)' }}>
                  Connected Platforms
                </h2>
                {Object.values(connections).some(Boolean) && (
                  <button
                    onClick={() => {
                      // Disconnect every currently-connected platform server-side.
                      Object.entries(connections)
                        .filter(([, isConnected]) => isConnected)
                        .forEach(([platformId]) => handleDisconnect(platformId))
                    }}
                    style={{
                      background: 'var(--panel)',
                      border: '1px solid var(--fail-line)',
                      borderRadius: '8px',
                      padding: '6px 12px',
                      fontSize: '12px',
                      color: 'var(--fail)',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    Disconnect All
                  </button>
                )}
              </div>
              <p style={{ color: 'var(--muted)', fontSize: '13px', marginBottom: '24px' }}>
                Connect your social accounts to publish directly from AutoMarketer.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {PLATFORM_CONFIGS.map((p) => {
                  const connected = connections[p.id] ?? false
                  const isLinkedIn = p.id === 'linkedin'
                  return (
                    <div key={p.id}>
                      {/* Platform row */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '14px',
                          padding: '16px',
                          borderRadius: isLinkedIn && connected && linkedInPages.length > 0
                            ? '10px 10px 0 0'
                            : '10px',
                          border: `1px solid ${connected ? 'var(--ok-line)' : 'var(--line)'}`,
                          borderBottom: isLinkedIn && connected && linkedInPages.length > 0
                            ? 'none'
                            : undefined,
                          background: connected ? 'var(--ok-soft)' : 'var(--sunken)',
                          transition: 'all 0.15s',
                        }}
                      >
                        <PlatformBadge platform={p.id} size="lg" />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--ink)' }}>{p.name}</div>
                          <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{p.description}</div>
                          {connected && (
                            <div style={{ fontSize: '11px', color: 'var(--ok)', marginTop: '2px' }}>
                              ✓ Connected
                            </div>
                          )}
                        </div>
                        <button
                          data-testid={`platform-btn-${p.id}`}
                          onClick={() => connected ? handleDisconnect(p.id) : openConnectModal(p)}
                          style={{
                            background: connected ? 'var(--panel)' : 'var(--primary)',
                            border: `1px solid ${connected ? 'var(--line)' : 'var(--accent)'}`,
                            borderRadius: '8px',
                            padding: '7px 16px',
                            fontSize: '13px',
                            color: connected ? 'var(--fail)' : 'var(--on-primary)',
                            cursor: 'pointer',
                            fontWeight: 600,
                            transition: 'all 0.15s',
                          }}
                        >
                          {connected ? 'Disconnect' : 'Connect'}
                        </button>
                      </div>

                      {/* LinkedIn page picker — shown only when connected and pages are available */}
                      {isLinkedIn && connected && (
                        <div
                          data-testid="linkedin-page-picker"
                          style={{
                            padding: '12px 16px',
                            borderRadius: '0 0 10px 10px',
                            border: '1px solid var(--ok-line)',
                            borderTop: '1px solid var(--ok-soft)',
                            background: 'var(--accent-soft)',
                          }}
                        >
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            flexWrap: 'wrap',
                          }}>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>
                              Post as:
                            </span>

                            {linkedInPagesLoading && (
                              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                                Loading pages…
                              </span>
                            )}

                            {!linkedInPagesLoading && linkedInPagesError && (
                              <span style={{ fontSize: '12px', color: 'var(--fail)' }}>
                                {linkedInPagesError}
                              </span>
                            )}

                            {!linkedInPagesLoading && !linkedInPagesError && linkedInPages.length === 0 && (
                              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                                No pages found — reconnect LinkedIn to refresh.
                              </span>
                            )}

                            {!linkedInPagesLoading && linkedInPages.length > 0 && (
                              <select
                                data-testid="linkedin-page-select"
                                value={selectedLinkedInPage?.urn ?? linkedInPages[0]?.urn ?? ''}
                                onChange={(e) => handleLinkedInPageChange(e.target.value)}
                                style={{
                                  fontSize: '12px',
                                  padding: '5px 8px',
                                  borderRadius: '6px',
                                  border: '1px solid var(--btn-line)',
                                  background: 'var(--panel)',
                                  color: 'var(--ink)',
                                  cursor: 'pointer',
                                  flex: 1,
                                  minWidth: '180px',
                                  maxWidth: '320px',
                                }}
                              >
                                {linkedInPages.map((page) => (
                                  <option key={page.urn} value={page.urn}>
                                    {page.type === 'organization' ? '🏢 ' : '👤 '}
                                    {page.name}
                                  </option>
                                ))}
                              </select>
                            )}

                            {!linkedInPagesLoading && linkedInPages.length > 1 && (
                              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                                {linkedInPages.length - 1} page{linkedInPages.length - 1 !== 1 ? 's' : ''} available
                              </span>
                            )}
                          </div>

                          {linkedInPages.length > 1 && (
                            <p style={{ fontSize: '11px', color: 'var(--muted)', margin: '6px 0 0' }}>
                              Switch between your personal profile and company pages. The selection applies to all LinkedIn posts.
                            </p>
                          )}

                          {linkedInPages.length === 1 && linkedInPages[0]?.type === 'person' && (
                            <p style={{ fontSize: '11px', color: 'var(--muted)', margin: '6px 0 0' }}>
                              Posting as a company page requires LinkedIn's "Community Management API" product, which is not available to most apps. Posts are published to your personal profile.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── AI Settings Tab ───────────────────────────────────────────── */}
          {activeTab === 'ai' && (
            <div>
              <h2 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>
                AI Settings
              </h2>
              <p style={{ color: 'var(--muted)', fontSize: '13px', marginBottom: '16px' }}>
                Configure how AutoMarketer generates content for your campaigns.
              </p>

              {/* ── Security notice ───────────────────────────────────────── */}
              <div
                style={{
                  background: 'var(--warn-soft)',
                  border: '1px solid var(--warn-line)',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  marginBottom: '20px',
                  fontSize: '12px',
                  color: 'var(--warn)',
                  lineHeight: 1.5,
                }}
              >
                <strong>Security note:</strong> API keys you enter here are stored in your browser's
                localStorage. Any JavaScript running on this page (including browser extensions) can
                read them. Use keys with{' '}
                <a
                  href="https://openrouter.ai/settings/limits"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: 'var(--warn)' }}
                >
                  spending limits
                </a>{' '}
                to cap potential exposure.
              </div>

              {/* ── Provider selection ────────────────────────────────────── */}
              <div style={sectionStyle}>
                <label style={labelStyle}>Inference Provider</label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  {(['openrouter', 'custom'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setAiConfig((prev) => ({ ...prev, provider: p }))}
                      style={{
                        flex: 1,
                        padding: '10px 16px',
                        borderRadius: '8px',
                        border: `2px solid ${aiConfig.provider === p ? 'var(--accent)' : 'var(--line)'}`,
                        background: aiConfig.provider === p ? 'var(--accent-soft)' : 'var(--panel)',
                        color: aiConfig.provider === p ? 'var(--accent)' : 'var(--muted)',
                        fontWeight: aiConfig.provider === p ? 600 : 400,
                        fontSize: '13px',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      {p === 'openrouter' ? '☁️ OpenRouter' : '🔧 Custom Endpoint'}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── OpenRouter section ────────────────────────────────────── */}
              {aiConfig.provider === 'openrouter' && (
                <div
                  style={{
                    background: 'var(--sunken)',
                    borderRadius: '10px',
                    border: '1px solid var(--line)',
                    padding: '16px',
                    marginBottom: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px',
                  }}
                >
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '2px' }}>
                    OpenRouter routes to 100+ models (GPT-4o, Claude, Gemini, Llama, …) via one API key.{' '}
                    <a
                      href="https://openrouter.ai/keys"
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--accent)' }}
                    >
                      Get a free key →
                    </a>
                  </div>

                  <div>
                    <label style={labelStyle}>API Key *</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        style={{ ...inputStyle, paddingRight: '60px' }}
                        placeholder="sk-or-v1-…"
                        value={aiConfig.providers.openrouter.apiKey}
                        onChange={(e) => updateProvider('openrouter', { apiKey: e.target.value })}
                        autoComplete="off"
                      />
                      <button
                        onClick={() => setShowApiKey((v) => !v)}
                        style={{
                          position: 'absolute',
                          right: '10px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          color: 'var(--muted)',
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontWeight: 500,
                        }}
                      >
                        {showApiKey ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    <p style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
                      Stored in your browser only — never sent to AutoMarketer servers.
                    </p>
                  </div>

                  <div>
                    <label style={labelStyle}>Model</label>
                    <input
                      style={inputStyle}
                      placeholder="e.g. openai/gpt-4o-mini"
                      value={aiConfig.providers.openrouter.model}
                      onChange={(e) => updateProvider('openrouter', { model: e.target.value })}
                    />
                    <p style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
                      Paste any model ID from{' '}
                      <a
                        href="https://openrouter.ai/models"
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: 'var(--accent)' }}
                      >
                        openrouter.ai/models
                      </a>
                      .
                    </p>
                  </div>

                  <div>
                    <label style={labelStyle}>Base URL</label>
                    <input
                      style={inputStyle}
                      placeholder="https://openrouter.ai/api/v1"
                      value={aiConfig.providers.openrouter.baseUrl}
                      onChange={(e) => updateProvider('openrouter', { baseUrl: e.target.value })}
                    />
                    <p style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
                      Leave as default unless you're using an OpenRouter-compatible proxy.
                    </p>
                  </div>
                </div>
              )}

              {/* ── Custom endpoint section ───────────────────────────────── */}
              {aiConfig.provider === 'custom' && (
                <div
                  style={{
                    background: 'var(--sunken)',
                    borderRadius: '10px',
                    border: '1px solid var(--line)',
                    padding: '16px',
                    marginBottom: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px',
                  }}
                >
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '2px' }}>
                    Any OpenAI-compatible <code style={{ background: 'var(--line)', padding: '1px 4px', borderRadius: '3px' }}>/chat/completions</code> endpoint works here —
                    Ollama, vLLM, LM Studio, LocalAI, or a private deployment.
                  </div>

                  <div>
                    <label style={labelStyle}>Endpoint URL *</label>
                    <input
                      style={{
                        ...inputStyle,
                        borderColor: endpointUrlError ? 'var(--fail)' : 'var(--line)',
                      }}
                      placeholder="http://localhost:11434/v1"
                      value={aiConfig.providers.custom.baseUrl}
                      onChange={(e) => handleCustomBaseUrlChange(e.target.value)}
                    />
                    {endpointUrlError ? (
                      <p style={{ fontSize: '11px', color: 'var(--fail)', marginTop: '4px' }}>
                        {endpointUrlError}
                      </p>
                    ) : (
                      <p style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
                        Base URL — AutoMarketer appends <code style={{ background: 'var(--line)', padding: '1px 3px', borderRadius: '3px' }}>/chat/completions</code>.
                      </p>
                    )}
                  </div>

                  <div>
                    <label style={labelStyle}>Model</label>
                    <input
                      style={inputStyle}
                      placeholder="e.g. llama3, gpt-4o-mini, mistral"
                      value={aiConfig.providers.custom.model}
                      onChange={(e) => updateProvider('custom', { model: e.target.value })}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>API Key</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showCustomApiKey ? 'text' : 'password'}
                        style={{ ...inputStyle, paddingRight: '60px' }}
                        placeholder="Optional — leave blank if your endpoint doesn't require auth"
                        value={aiConfig.providers.custom.apiKey}
                        onChange={(e) => updateProvider('custom', { apiKey: e.target.value })}
                        autoComplete="off"
                      />
                      <button
                        onClick={() => setShowCustomApiKey((v) => !v)}
                        style={{
                          position: 'absolute',
                          right: '10px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          color: 'var(--muted)',
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontWeight: 500,
                        }}
                      >
                        {showCustomApiKey ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Content defaults ──────────────────────────────────────── */}
              <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: '20px', marginTop: '4px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink-2)', marginBottom: '14px' }}>
                  Content Defaults
                </div>

                <div style={sectionStyle}>
                  <label style={labelStyle}>Default Tone</label>
                  <select
                    style={inputStyle}
                    value={aiConfig.defaults.tone}
                    onChange={(e) =>
                      updateDefaults({ tone: e.target.value as AIConfig['defaults']['tone'] })
                    }
                  >
                    {TONES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={sectionStyle}>
                  <label style={labelStyle}>Emoji Usage</label>
                  <select
                    style={inputStyle}
                    value={aiConfig.defaults.emojiUsage}
                    onChange={(e) =>
                      updateDefaults({
                        emojiUsage: e.target.value as AIConfig['defaults']['emojiUsage'],
                      })
                    }
                  >
                    {EMOJI_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={sectionStyle}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px 16px',
                      borderRadius: '10px',
                      border: '1px solid var(--line)',
                      background: 'var(--sunken)',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--ink)' }}>
                        Auto-generate Hashtags
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                        Automatically add relevant hashtags to all posts
                      </div>
                    </div>
                    <Toggle
                      on={aiConfig.defaults.autoHashtags}
                      onChange={() => updateDefaults({ autoHashtags: !aiConfig.defaults.autoHashtags })}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Notifications Tab ─────────────────────────────────────────── */}
          {activeTab === 'notifications' && (
            <div>
              <h2 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>
                Notifications
              </h2>
              <p style={{ color: 'var(--muted)', fontSize: '13px', marginBottom: '24px' }}>
                Choose what notifications you receive.
              </p>

              {NOTIFICATIONS.map(({ id, title, desc }) => {
                const on = notifications[id]
                return (
                  <div
                    key={id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px 0',
                      borderBottom: '1px solid var(--line-soft)',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '14px', color: 'var(--ink)' }}>{title}</div>
                      <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{desc}</div>
                    </div>
                    <Toggle on={on} onChange={() => toggleNotification(id)} testId={id} />
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Save button ───────────────────────────────────────────────── */}
          <div style={{ marginTop: '28px', paddingTop: '20px', borderTop: '1px solid var(--line-soft)' }}>
            {saveError && (
              <p
                style={{
                  fontSize: '12px',
                  color: 'var(--fail)',
                  marginBottom: '10px',
                  padding: '8px 12px',
                  background: 'var(--fail-soft)',
                  borderRadius: '6px',
                  border: '1px solid var(--fail-line)',
                }}
              >
                Settings could not be saved: {saveError}
              </p>
            )}
            <button
              onClick={handleSave}
              style={{
                background: saved
                  ? 'var(--ok)'
                  : 'var(--primary)',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 24px',
                color: 'var(--on-primary)',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.2s',
                boxShadow: saved
                  ? 'none'
                  : 'none',
              }}
            >
              {saved ? '✓ Changes Saved' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>

      {/* Platform connection modal */}
      {connectingPlatform && (
        <PlatformConnectionModal
          platform={connectingPlatform}
          onClose={() => setConnectingPlatform(null)}
          onConnect={handleConnectComplete}
        />
      )}
    </div>
  )
}

export default Settings
