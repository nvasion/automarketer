import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { parseUserDetailsFromEmail } from '../utils/userDisplay'
import { PLATFORM_CONFIGS } from '../data/sampleData'
import { loadAIConfig, saveAIConfig, validateEndpointUrl } from '../config/aiConfig'
import type { AIConfig, ProviderConfig } from '../config/aiConfig'
import PlatformBadge from '../components/PlatformBadge'
import DemoBadge from '../components/DemoBadge'

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
  linkedin: true,
  twitter: true,
  reddit: false,
  facebook: false,
  instagram: false,
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
        background: on ? '#52b788' : '#e2e8f0',
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
          background: 'white',
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
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [notifications, setNotifications] = useState<Record<string, boolean>>(DEFAULT_NOTIFICATIONS)

  // AI config — loaded from localStorage on mount
  const [aiConfig, setAiConfig] = useState<AIConfig>(loadAIConfig)
  const [showApiKey, setShowApiKey] = useState(false)
  const [showCustomApiKey, setShowCustomApiKey] = useState(false)
  const [endpointUrlError, setEndpointUrlError] = useState<string | null>(null)

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

  const toggleConnection = (platform: string) => {
    setConnections((prev) => ({ ...prev, [platform]: !prev[platform] }))
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
    border: '1px solid #e2e8f0',
    fontSize: '14px',
    color: '#1e293b',
    outline: 'none',
    background: 'white',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '13px',
    fontWeight: 600,
    color: '#374151',
    marginBottom: '6px',
  }

  const sectionStyle: React.CSSProperties = { marginBottom: '20px' }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '32px' }}>
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
          Settings
        </h1>
        <p style={{ color: '#64748b', fontSize: '14px' }}>
          Manage your account, platforms, and AI preferences.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '24px' }}>
        {/* Tab nav */}
        <div
          style={{
            background: 'white',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
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
                background: activeTab === id ? '#d8f3dc' : 'transparent',
                color: activeTab === id ? '#40916c' : '#64748b',
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
            background: 'white',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            padding: '28px',
          }}
        >
          {/* ── Profile Tab ──────────────────────────────────────────────── */}
          {activeTab === 'profile' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <h2 style={{ fontSize: '17px', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                  Profile Settings
                </h2>
                <DemoBadge />
              </div>
              <p style={{ color: '#64748b', fontSize: '13px', marginBottom: '16px' }}>
                Update your account information.
              </p>
              <div
                style={{
                  background: '#fef3c7',
                  border: '1px solid #fde68a',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  marginBottom: '20px',
                  fontSize: '12px',
                  color: '#92400e',
                  lineHeight: 1.5,
                }}
              >
                <strong>Demo data:</strong> The name, email, and company below are prefilled as sample values. Replace them with your real information.
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
                <div
                  style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #52b788, #40916c)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: '24px',
                    fontWeight: 700,
                  }}
                >
                  {initial}
                </div>
                <div>
                  <button
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      padding: '7px 14px',
                      fontSize: '13px',
                      color: '#374151',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    Change Avatar
                  </button>
                  <p style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
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
            </div>
          )}

          {/* ── Platforms Tab ─────────────────────────────────────────────── */}
          {activeTab === 'platforms' && (
            <div>
              <h2 style={{ fontSize: '17px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                Connected Platforms
              </h2>
              <p style={{ color: '#64748b', fontSize: '13px', marginBottom: '24px' }}>
                Connect your social accounts to publish directly from AutoMarketer.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {PLATFORM_CONFIGS.map((p) => {
                  const connected = connections[p.id] ?? false
                  return (
                    <div
                      key={p.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '14px',
                        padding: '16px',
                        borderRadius: '10px',
                        border: `1px solid ${connected ? '#bbf7d0' : '#e2e8f0'}`,
                        background: connected ? '#f0fdf4' : '#fafbfc',
                        transition: 'all 0.15s',
                      }}
                    >
                      <PlatformBadge platform={p.id} size="lg" />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '14px', color: '#1e293b' }}>{p.name}</div>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>{p.description}</div>
                        {connected && (
                          <div style={{ fontSize: '11px', color: '#16a34a', marginTop: '2px' }}>
                            ✓ Connected
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => toggleConnection(p.id)}
                        style={{
                          background: connected ? 'white' : '#52b788',
                          border: `1px solid ${connected ? '#e2e8f0' : '#52b788'}`,
                          borderRadius: '8px',
                          padding: '7px 16px',
                          fontSize: '13px',
                          color: connected ? '#dc2626' : 'white',
                          cursor: 'pointer',
                          fontWeight: 600,
                          transition: 'all 0.15s',
                        }}
                      >
                        {connected ? 'Disconnect' : 'Connect'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── AI Settings Tab ───────────────────────────────────────────── */}
          {activeTab === 'ai' && (
            <div>
              <h2 style={{ fontSize: '17px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                AI Settings
              </h2>
              <p style={{ color: '#64748b', fontSize: '13px', marginBottom: '16px' }}>
                Configure how AutoMarketer generates content for your campaigns.
              </p>

              {/* ── Security notice ───────────────────────────────────────── */}
              <div
                style={{
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  marginBottom: '20px',
                  fontSize: '12px',
                  color: '#92400e',
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
                  style={{ color: '#92400e' }}
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
                        border: `2px solid ${aiConfig.provider === p ? '#52b788' : '#e2e8f0'}`,
                        background: aiConfig.provider === p ? '#d8f3dc' : 'white',
                        color: aiConfig.provider === p ? '#40916c' : '#64748b',
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
                    background: '#f8fafc',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                    padding: '16px',
                    marginBottom: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px',
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '2px' }}>
                    OpenRouter routes to 100+ models (GPT-4o, Claude, Gemini, Llama, …) via one API key.{' '}
                    <a
                      href="https://openrouter.ai/keys"
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#52b788' }}
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
                          color: '#94a3b8',
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontWeight: 500,
                        }}
                      >
                        {showApiKey ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    <p style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
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
                    <p style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                      Paste any model ID from{' '}
                      <a
                        href="https://openrouter.ai/models"
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#52b788' }}
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
                    <p style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                      Leave as default unless you're using an OpenRouter-compatible proxy.
                    </p>
                  </div>
                </div>
              )}

              {/* ── Custom endpoint section ───────────────────────────────── */}
              {aiConfig.provider === 'custom' && (
                <div
                  style={{
                    background: '#f8fafc',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                    padding: '16px',
                    marginBottom: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px',
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '2px' }}>
                    Any OpenAI-compatible <code style={{ background: '#e2e8f0', padding: '1px 4px', borderRadius: '3px' }}>/chat/completions</code> endpoint works here —
                    Ollama, vLLM, LM Studio, LocalAI, or a private deployment.
                  </div>

                  <div>
                    <label style={labelStyle}>Endpoint URL *</label>
                    <input
                      style={{
                        ...inputStyle,
                        borderColor: endpointUrlError ? '#ef4444' : '#e2e8f0',
                      }}
                      placeholder="http://localhost:11434/v1"
                      value={aiConfig.providers.custom.baseUrl}
                      onChange={(e) => handleCustomBaseUrlChange(e.target.value)}
                    />
                    {endpointUrlError ? (
                      <p style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px' }}>
                        {endpointUrlError}
                      </p>
                    ) : (
                      <p style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                        Base URL — AutoMarketer appends <code style={{ background: '#e2e8f0', padding: '1px 3px', borderRadius: '3px' }}>/chat/completions</code>.
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
                          color: '#94a3b8',
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
              <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '20px', marginTop: '4px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '14px' }}>
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
                      border: '1px solid #e2e8f0',
                      background: '#fafbfc',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '14px', color: '#1e293b' }}>
                        Auto-generate Hashtags
                      </div>
                      <div style={{ fontSize: '12px', color: '#94a3b8' }}>
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
              <h2 style={{ fontSize: '17px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                Notifications
              </h2>
              <p style={{ color: '#64748b', fontSize: '13px', marginBottom: '24px' }}>
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
                      borderBottom: '1px solid #f1f5f9',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '14px', color: '#1e293b' }}>{title}</div>
                      <div style={{ fontSize: '12px', color: '#94a3b8' }}>{desc}</div>
                    </div>
                    <Toggle on={on} onChange={() => toggleNotification(id)} testId={id} />
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Save button ───────────────────────────────────────────────── */}
          <div style={{ marginTop: '28px', paddingTop: '20px', borderTop: '1px solid #f1f5f9' }}>
            {saveError && (
              <p
                style={{
                  fontSize: '12px',
                  color: '#dc2626',
                  marginBottom: '10px',
                  padding: '8px 12px',
                  background: '#fef2f2',
                  borderRadius: '6px',
                  border: '1px solid #fecaca',
                }}
              >
                Settings could not be saved: {saveError}
              </p>
            )}
            <button
              onClick={handleSave}
              style={{
                background: saved
                  ? '#16a34a'
                  : 'linear-gradient(135deg, #52b788, #40916c)',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 24px',
                color: 'white',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.2s',
                boxShadow: saved
                  ? '0 4px 14px rgba(22,163,74,0.3)'
                  : '0 4px 14px rgba(82,183,136,0.35)',
              }}
            >
              {saved ? '✓ Changes Saved' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Settings
