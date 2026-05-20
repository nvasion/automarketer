import { useState } from 'react'
import { PLATFORM_CONFIGS } from '../data/sampleData'
import PlatformBadge from '../components/PlatformBadge'

type SettingsTab = 'profile' | 'platforms' | 'ai' | 'notifications'

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

function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile')
  const [connections, setConnections] = useState(CONNECTED)
  const [saved, setSaved] = useState(false)
  const [aiModel, setAiModel] = useState('claude-3-7-sonnet')
  const [defaultTone, setDefaultTone] = useState('professional')
  const [autoHashtags, setAutoHashtags] = useState(true)
  const [emojiUsage, setEmojiUsage] = useState('moderate')

  const handleSave = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const toggleConnection = (platform: string) => {
    setConnections((prev) => ({ ...prev, [platform]: !prev[platform] }))
  }

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
                background: activeTab === id ? '#eff0ff' : 'transparent',
                color: activeTab === id ? '#6366f1' : '#64748b',
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
          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <div>
              <h2 style={{ fontSize: '17px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                Profile Settings
              </h2>
              <p style={{ color: '#64748b', fontSize: '13px', marginBottom: '24px' }}>
                Update your account information.
              </p>

              {/* Avatar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
                <div
                  style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: '24px',
                    fontWeight: 700,
                  }}
                >
                  K
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
                    JPG, PNG max 2MB
                  </p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <label style={labelStyle}>First Name</label>
                  <input style={inputStyle} defaultValue="Ted" />
                </div>
                <div>
                  <label style={labelStyle}>Last Name</label>
                  <input style={inputStyle} defaultValue="Marketeer" />
                </div>
              </div>
              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>Email Address</label>
                <input style={inputStyle} defaultValue="tedm@example.com" />
              </div>
              <div style={{ marginBottom: '24px' }}>
                <label style={labelStyle}>Company / Brand Name</label>
                <input style={inputStyle} defaultValue="AutoMarketer" />
              </div>
            </div>
          )}

          {/* Platforms Tab */}
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
                          background: connected ? 'white' : '#6366f1',
                          border: `1px solid ${connected ? '#e2e8f0' : '#6366f1'}`,
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

          {/* AI Settings Tab */}
          {activeTab === 'ai' && (
            <div>
              <h2 style={{ fontSize: '17px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                AI Settings
              </h2>
              <p style={{ color: '#64748b', fontSize: '13px', marginBottom: '24px' }}>
                Configure how AutoMarketer generates content for your campaigns.
              </p>

              <div style={{ marginBottom: '20px' }}>
                <label style={labelStyle}>AI Model</label>
                <select
                  style={inputStyle}
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                >
                  <option value="claude-4-6-sonnet">Claude 4.6 Sonnet (Recommended)</option>
                  <option value="claude-opus-4-7">Claude Opus 4.7 (Most Powerful)</option>
                  <option value="claude-haiku-4-5">Claude Haiku 4.5 (Fastest)</option>
                </select>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={labelStyle}>Default Tone</label>
                <select
                  style={inputStyle}
                  value={defaultTone}
                  onChange={(e) => setDefaultTone(e.target.value)}
                >
                  <option value="professional">Professional</option>
                  <option value="casual">Casual</option>
                  <option value="excited">Excited</option>
                  <option value="informative">Informative</option>
                </select>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={labelStyle}>Emoji Usage</label>
                <select
                  style={inputStyle}
                  value={emojiUsage}
                  onChange={(e) => setEmojiUsage(e.target.value)}
                >
                  <option value="none">None</option>
                  <option value="minimal">Minimal</option>
                  <option value="moderate">Moderate</option>
                  <option value="heavy">Heavy</option>
                </select>
              </div>

              <div style={{ marginBottom: '24px' }}>
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
                    <div style={{ fontWeight: 600, fontSize: '14px', color: '#1e293b' }}>Auto-generate Hashtags</div>
                    <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                      Automatically add relevant hashtags to all posts
                    </div>
                  </div>
                  <div
                    onClick={() => setAutoHashtags(!autoHashtags)}
                    style={{
                      width: '44px',
                      height: '24px',
                      borderRadius: '12px',
                      background: autoHashtags ? '#6366f1' : '#e2e8f0',
                      cursor: 'pointer',
                      position: 'relative',
                      transition: 'background 0.2s',
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        width: '18px',
                        height: '18px',
                        borderRadius: '50%',
                        background: 'white',
                        position: 'absolute',
                        top: '3px',
                        left: autoHashtags ? '23px' : '3px',
                        transition: 'left 0.2s',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Notifications Tab */}
          {activeTab === 'notifications' && (
            <div>
              <h2 style={{ fontSize: '17px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                Notifications
              </h2>
              <p style={{ color: '#64748b', fontSize: '13px', marginBottom: '24px' }}>
                Choose what notifications you receive.
              </p>

              {[
                {
                  title: 'Post Published',
                  desc: 'Get notified when a post goes live',
                  defaultOn: true,
                },
                {
                  title: 'Engagement Milestones',
                  desc: 'Alerts when posts reach 1k, 5k, 10k engagements',
                  defaultOn: true,
                },
                {
                  title: 'Generation Complete',
                  desc: 'When AI finishes generating your campaign posts',
                  defaultOn: true,
                },
                {
                  title: 'Weekly Digest',
                  desc: 'Summary of performance every Monday morning',
                  defaultOn: false,
                },
                {
                  title: 'Platform Errors',
                  desc: 'Alerts when a post fails to publish',
                  defaultOn: true,
                },
              ].map(({ title, desc, defaultOn }) => {
                const [on, setOn] = useState(defaultOn)
                return (
                  <div
                    key={title}
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
                    <div
                      onClick={() => setOn(!on)}
                      style={{
                        width: '44px',
                        height: '24px',
                        borderRadius: '12px',
                        background: on ? '#6366f1' : '#e2e8f0',
                        cursor: 'pointer',
                        position: 'relative',
                        transition: 'background 0.2s',
                        flexShrink: 0,
                      }}
                    >
                      <div
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
                  </div>
                )
              })}
            </div>
          )}

          {/* Save button */}
          <div style={{ marginTop: '28px', paddingTop: '20px', borderTop: '1px solid #f1f5f9' }}>
            <button
              onClick={handleSave}
              style={{
                background: saved
                  ? '#16a34a'
                  : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 24px',
                color: 'white',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.2s',
                boxShadow: saved ? '0 4px 14px rgba(22,163,74,0.3)' : '0 4px 14px rgba(99,102,241,0.35)',
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
