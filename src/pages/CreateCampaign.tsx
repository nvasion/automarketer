import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Platform, Tone, Screenshot } from '../types'
import { PLATFORM_CONFIGS } from '../data/sampleData'
import { loadAIConfig } from '../config/aiConfig'
import { useContentGeneration } from '../hooks/useContentGeneration'
import PlatformBadge from '../components/PlatformBadge'

type Step = 1 | 2 | 3 | 4

const TONES: { id: Tone; label: string; desc: string; icon: string }[] = [
  { id: 'professional', label: 'Professional', desc: 'Formal and authoritative', icon: '💼' },
  { id: 'casual', label: 'Casual', desc: 'Friendly and conversational', icon: '😊' },
  { id: 'excited', label: 'Excited', desc: 'Energetic and enthusiastic', icon: '🚀' },
  { id: 'informative', label: 'Informative', desc: 'Educational and detailed', icon: '📚' },
]

/** Template posts used as a fallback when no API key is configured. */
const TEMPLATE_POSTS: Record<Platform, string> = {
  linkedin: `🚀 Exciting news! We're thrilled to introduce our latest product — built to solve real problems for teams like yours.\n\nAfter months of development and feedback from hundreds of users, we've created something we're genuinely proud of:\n\n✅ Powerful features that just work\n✅ An intuitive interface your team will love\n✅ Enterprise-grade security and reliability\n\nWe believe great tools should get out of your way and let you focus on what matters.\n\nWe're opening early access today. Click below to get started — no credit card required.\n\nWhat's the biggest challenge your team faces right now? Drop it in the comments — we'd love to hear from you.`,
  twitter: `Big news 🎉\n\nWe just launched something we've been building for months.\n\nThe result? A product that makes your workflow 10× smoother.\n\n→ Fast\n→ Intuitive\n→ Built with teams in mind\n\nEarly access is open now 👇`,
  reddit: `Hey everyone! Long-time lurker, first time poster (about our own stuff — I promise we'll make it worth your time).\n\nWe just shipped our product publicly after 6 months in private beta with ~200 teams.\n\n**What problem are we solving?** [Based on your website description]\n\n**What makes it different?** We talked to 300+ potential users before writing a single line of code. Every feature exists because real people asked for it.\n\nNo fluff, no hype — just a tool that does what it says it does.\n\nHappy to answer any questions about the build process, design decisions, or the product itself. Looking forward to the brutal feedback this community is known for.`,
  facebook: `We've got some exciting news to share! 🎉\n\nOur new product is officially live, and we couldn't be more excited to finally share it with the world.\n\nWe've been heads-down building something that we think will make a real difference. Whether you're a small team or a growing enterprise, this was built with you in mind.\n\n✨ Easy to get started\n📈 Scales with your needs\n🔒 Secure by default\n\nWe're offering a free trial — no strings attached. Come check it out and let us know what you think!`,
  instagram: `Something big is here ✨\n\nWe built this because we were tired of tools that promise a lot and deliver little.\n\nThis is different. Simple. Powerful. Yours.\n\nLink in bio to get started free. 🔗\n\nTag a friend who needs this 👇`,
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: Step; total: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0', marginBottom: '32px' }}>
      {Array.from({ length: total }, (_, i) => i + 1).map((step) => (
        <div key={step} style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '13px',
              background:
                step <= current
                  ? 'linear-gradient(135deg, #52b788, #40916c)'
                  : '#e2e8f0',
              color: step <= current ? 'white' : '#94a3b8',
              transition: 'all 0.3s',
            }}
          >
            {step < current ? '✓' : step}
          </div>
          {step < total && (
            <div
              style={{
                height: '2px',
                width: '80px',
                background: step < current ? '#52b788' : '#e2e8f0',
                transition: 'background 0.3s',
              }}
            />
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

function CreateCampaign() {
  const navigate = useNavigate()
  const { generate, error: generationError, clearError } = useContentGeneration()

  // Form fields
  const [step, setStep] = useState<Step>(1)
  const [campaignName, setCampaignName] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [description, setDescription] = useState('')
  const [targetAudience, setTargetAudience] = useState('')
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(['linkedin', 'twitter'])
  const [tone, setTone] = useState<Tone>('professional')
  const [screenshots, setScreenshots] = useState<Screenshot[]>([])

  // Generation state
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState(false)
  const [usedFallback, setUsedFallback] = useState(false)
  const [generatedPosts, setGeneratedPosts] = useState<Partial<Record<Platform, string>>>({})

  const fileRef = useRef<HTMLInputElement>(null)

  // ── Handlers ────────────────────────────────────────────────────────────────

  const togglePlatform = (p: Platform) => {
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    )
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    const newScreenshots: Screenshot[] = files.map((f, i) => ({
      id: `ss-new-${Date.now()}-${i}`,
      name: f.name,
      url: URL.createObjectURL(f),
      type: f.type,
    }))
    setScreenshots((prev) => [...prev, ...newScreenshots])
  }

  const removeScreenshot = (id: string) => {
    setScreenshots((prev) => prev.filter((s) => s.id !== id))
  }

  /**
   * Detect whether the user has a valid inference endpoint configured.
   * Returns false when the provider is openrouter with no API key, or
   * custom with no base URL.
   */
  const hasInferenceConfig = (): boolean => {
    const config = loadAIConfig()
    if (config.provider === 'openrouter') return Boolean(config.openRouter.apiKey)
    return Boolean(config.custom.baseUrl)
  }

  const handleGenerate = async () => {
    clearError()
    setGenerating(true)
    setGenerated(false)
    setUsedFallback(false)
    setStep(4) // move to review step immediately so the spinner is visible

    try {
      if (!hasInferenceConfig()) {
        // No API key → use built-in template content after a brief delay
        await new Promise((res) => setTimeout(res, 1400))
        const posts: Partial<Record<Platform, string>> = {}
        selectedPlatforms.forEach((p) => {
          posts[p] = TEMPLATE_POSTS[p]
        })
        setGeneratedPosts(posts)
        setUsedFallback(true)
        setGenerated(true)
        return
      }

      // Real AI generation
      const drafts = await generate({
        campaignName,
        websiteUrl,
        description,
        targetAudience,
        platforms: selectedPlatforms,
        tone,
      })

      const posts: Partial<Record<Platform, string>> = {}
      for (const draft of drafts) {
        const body = draft.hashtags.length > 0
          ? `${draft.content}\n\n${draft.hashtags.join(' ')}`
          : draft.content
        posts[draft.platform] = body
      }
      setGeneratedPosts(posts)
      setGenerated(true)
    } catch {
      // generationError is set by the hook; go back to step 3 so the user
      // can see the error and retry
      setStep(3)
    } finally {
      setGenerating(false)
    }
  }

  // ── Shared styles ───────────────────────────────────────────────────────────

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    borderRadius: '8px',
    border: '1px solid #e2e8f0',
    fontSize: '14px',
    color: '#1e293b',
    outline: 'none',
    transition: 'border-color 0.15s',
    background: 'white',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '13px',
    fontWeight: 600,
    color: '#374151',
    marginBottom: '6px',
  }

  const fieldStyle: React.CSSProperties = { marginBottom: '20px' }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '32px', maxWidth: '800px' }}>
      <div style={{ marginBottom: '8px' }}>
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'none',
            border: 'none',
            color: '#52b788',
            fontSize: '13px',
            cursor: 'pointer',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            marginBottom: '16px',
          }}
        >
          ← Back to Dashboard
        </button>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
          Create Campaign
        </h1>
        <p style={{ color: '#64748b', fontSize: '14px' }}>
          Enter your website details and let AI craft the perfect posts for each platform.
        </p>
      </div>

      <div
        style={{
          background: 'white',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          padding: '32px',
          marginTop: '24px',
        }}
      >
        <StepIndicator current={step} total={4} />

        {/* ── Step 1: Website Info ────────────────────────────────────────── */}
        {step === 1 && (
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
              Website Information
            </h2>
            <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '24px' }}>
              Tell us about the product or service you want to promote.
            </p>

            <div style={fieldStyle}>
              <label style={labelStyle}>Campaign Name *</label>
              <input
                style={inputStyle}
                placeholder="e.g. Q2 Product Launch"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
              />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Website URL *</label>
              <input
                style={inputStyle}
                placeholder="https://yourproduct.com"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
              />
              <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
                AI will use this for on-brand, accurate content.
              </p>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Product / Service Description *</label>
              <textarea
                style={{ ...inputStyle, minHeight: '100px', resize: 'vertical' }}
                placeholder="Briefly describe what you're promoting, the key benefits, and what makes it unique…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Target Audience</label>
              <input
                style={inputStyle}
                placeholder="e.g. Startup founders and product managers"
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* ── Step 2: Screenshots ─────────────────────────────────────────── */}
        {step === 2 && (
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
              Upload Screenshots
            </h2>
            <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '24px' }}>
              Add screenshots of your product or landing page. AI will use these for richer context.
            </p>

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />

            <div
              onClick={() => fileRef.current?.click()}
              style={{
                border: '2px dashed #b7e4c7',
                borderRadius: '12px',
                padding: '40px',
                textAlign: 'center',
                cursor: 'pointer',
                background: '#f0fdf4',
                transition: 'all 0.15s',
                marginBottom: '20px',
              }}
            >
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>📸</div>
              <p style={{ fontWeight: 600, color: '#40916c', marginBottom: '4px' }}>
                Click to upload screenshots
              </p>
              <p style={{ color: '#94a3b8', fontSize: '13px' }}>PNG, JPG, GIF up to 10 MB each</p>
            </div>

            {screenshots.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                {screenshots.map((ss) => (
                  <div
                    key={ss.id}
                    style={{
                      position: 'relative',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      border: '1px solid #e2e8f0',
                      aspectRatio: '16/9',
                      background: '#f1f5f9',
                    }}
                  >
                    {ss.url ? (
                      <img
                        src={ss.url}
                        alt={ss.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '24px',
                        }}
                      >
                        🖼️
                      </div>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); removeScreenshot(ss.id) }}
                      style={{
                        position: 'absolute',
                        top: '6px',
                        right: '6px',
                        width: '22px',
                        height: '22px',
                        borderRadius: '50%',
                        background: 'rgba(0,0,0,0.6)',
                        border: 'none',
                        color: 'white',
                        fontSize: '12px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        background: 'rgba(0,0,0,0.5)',
                        color: 'white',
                        fontSize: '10px',
                        padding: '4px 6px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {ss.name}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p style={{ color: '#64748b', fontSize: '13px', marginTop: '12px' }}>
              {screenshots.length === 0
                ? '💡 Screenshots are optional but help AI generate more accurate content.'
                : `✅ ${screenshots.length} screenshot${screenshots.length !== 1 ? 's' : ''} added.`}
            </p>
          </div>
        )}

        {/* ── Step 3: Platforms & Tone ────────────────────────────────────── */}
        {step === 3 && (
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
              Platforms & Tone
            </h2>
            <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '24px' }}>
              Choose where to post and the writing style for the generated content.
            </p>

            <div style={fieldStyle}>
              <label style={labelStyle}>Target Platforms *</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                {PLATFORM_CONFIGS.map((p) => {
                  const selected = selectedPlatforms.includes(p.id)
                  return (
                    <div
                      key={p.id}
                      onClick={() => togglePlatform(p.id)}
                      style={{
                        border: `2px solid ${selected ? '#52b788' : '#e2e8f0'}`,
                        borderRadius: '10px',
                        padding: '12px 14px',
                        cursor: 'pointer',
                        background: selected ? '#d8f3dc' : 'white',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        transition: 'all 0.15s',
                      }}
                    >
                      <PlatformBadge platform={p.id} size="md" />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>{p.name}</div>
                        <div style={{ fontSize: '11px', color: '#94a3b8' }}>{p.description}</div>
                      </div>
                      {selected && (
                        <span
                          style={{
                            marginLeft: 'auto',
                            width: '20px',
                            height: '20px',
                            borderRadius: '50%',
                            background: '#52b788',
                            color: 'white',
                            fontSize: '11px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          ✓
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Writing Tone</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                {TONES.map((t) => {
                  const selected = tone === t.id
                  return (
                    <div
                      key={t.id}
                      onClick={() => setTone(t.id)}
                      style={{
                        border: `2px solid ${selected ? '#52b788' : '#e2e8f0'}`,
                        borderRadius: '10px',
                        padding: '12px 14px',
                        cursor: 'pointer',
                        background: selected ? '#d8f3dc' : 'white',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        transition: 'all 0.15s',
                      }}
                    >
                      <span style={{ fontSize: '22px' }}>{t.icon}</span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>{t.label}</div>
                        <div style={{ fontSize: '11px', color: '#94a3b8' }}>{t.desc}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Generation error banner (shown after a failed attempt) */}
            {generationError && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '10px',
                  padding: '14px 16px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  marginTop: '8px',
                }}
              >
                <span style={{ fontSize: '18px', flexShrink: 0 }}>⚠️</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: '#991b1b', marginBottom: '2px' }}>
                    Generation failed
                  </div>
                  <div style={{ color: '#b91c1c', fontSize: '13px' }}>{generationError}</div>
                  <div style={{ color: '#7f1d1d', fontSize: '12px', marginTop: '6px' }}>
                    Check your API key in{' '}
                    <button
                      onClick={() => navigate('/settings')}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#7f1d1d',
                        textDecoration: 'underline',
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: '12px',
                      }}
                    >
                      Settings → AI Settings
                    </button>{' '}
                    or retry below.
                  </div>
                </div>
              </div>
            )}

            {/* No-key notice */}
            {!hasInferenceConfig() && !generationError && (
              <div
                style={{
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: '10px',
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  marginTop: '8px',
                }}
              >
                <span style={{ fontSize: '18px', flexShrink: 0 }}>💡</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '13px', color: '#92400e' }}>
                    No AI key configured — will use template content
                  </div>
                  <div style={{ color: '#a16207', fontSize: '12px', marginTop: '2px' }}>
                    Add an OpenRouter API key in{' '}
                    <button
                      onClick={() => navigate('/settings')}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#a16207',
                        textDecoration: 'underline',
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: '12px',
                      }}
                    >
                      Settings → AI Settings
                    </button>{' '}
                    for personalised, campaign-specific posts.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Step 4: Generated Content ───────────────────────────────────── */}
        {step === 4 && (
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
              ✨ AI-Generated Content
            </h2>
            <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '24px' }}>
              Review and edit your generated posts before publishing or scheduling.
            </p>

            {/* Spinner */}
            {generating && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: '60px',
                  gap: '16px',
                }}
              >
                <div
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '50%',
                    border: '3px solid #e2e8f0',
                    borderTopColor: '#52b788',
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
                <div style={{ fontWeight: 600, color: '#1e293b' }}>Generating your content…</div>
                <div style={{ color: '#94a3b8', fontSize: '13px', textAlign: 'center' }}>
                  AI is crafting platform-specific posts for your campaign
                </div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            )}

            {/* Generated posts */}
            {generated && !generating && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Fallback notice */}
                {usedFallback && (
                  <div
                    style={{
                      background: '#fffbeb',
                      border: '1px solid #fde68a',
                      borderRadius: '10px',
                      padding: '12px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                    }}
                  >
                    <span style={{ fontSize: '18px' }}>💡</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '13px', color: '#92400e' }}>
                        Using template content
                      </div>
                      <div style={{ color: '#a16207', fontSize: '12px' }}>
                        These are generic drafts. Add an OpenRouter API key in{' '}
                        <button
                          onClick={() => navigate('/settings')}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#a16207',
                            textDecoration: 'underline',
                            cursor: 'pointer',
                            padding: 0,
                            fontSize: '12px',
                          }}
                        >
                          Settings → AI Settings
                        </button>{' '}
                        for campaign-specific, personalised posts.
                      </div>
                    </div>
                  </div>
                )}

                {selectedPlatforms.map((platform) => {
                  const content = generatedPosts[platform] ?? ''
                  const cfg = PLATFORM_CONFIGS.find((p) => p.id === platform)
                  return (
                    <div
                      key={platform}
                      style={{
                        border: '1px solid #e2e8f0',
                        borderRadius: '12px',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          background: '#fafbfc',
                          padding: '12px 16px',
                          borderBottom: '1px solid #f1f5f9',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                        }}
                      >
                        <PlatformBadge platform={platform} size="md" />
                        <span style={{ fontWeight: 600, fontSize: '14px' }}>{cfg?.name}</span>
                        <span style={{ color: '#94a3b8', fontSize: '12px', marginLeft: 'auto' }}>
                          {content.length}/{cfg?.charLimit} chars
                        </span>
                      </div>
                      <div style={{ padding: '16px' }}>
                        <textarea
                          defaultValue={content}
                          style={{
                            width: '100%',
                            border: 'none',
                            outline: 'none',
                            fontSize: '14px',
                            lineHeight: '1.65',
                            color: '#334155',
                            resize: 'vertical',
                            minHeight: '120px',
                            background: 'transparent',
                          }}
                        />
                      </div>
                    </div>
                  )
                })}

                <div
                  style={{
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: '10px',
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                  }}
                >
                  <span style={{ fontSize: '20px' }}>✅</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px', color: '#15803d' }}>
                      Content ready to publish!
                    </div>
                    <div style={{ color: '#16a34a', fontSize: '12px' }}>
                      {selectedPlatforms.length} post{selectedPlatforms.length !== 1 ? 's' : ''} generated.
                      Review above and click "Save Campaign" when ready.
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Navigation buttons ──────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '32px',
            paddingTop: '24px',
            borderTop: '1px solid #f1f5f9',
          }}
        >
          <button
            onClick={() => (step > 1 ? setStep((prev) => (prev - 1) as Step) : navigate('/'))}
            disabled={generating}
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '10px 20px',
              fontSize: '14px',
              color: generating ? '#94a3b8' : '#64748b',
              cursor: generating ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
          >
            {step === 1 ? 'Cancel' : '← Back'}
          </button>

          <div style={{ display: 'flex', gap: '10px' }}>
            {step < 3 && (
              <button
                onClick={() => setStep((prev) => (prev + 1) as Step)}
                disabled={step === 1 && (!campaignName.trim() || !websiteUrl.trim() || !description.trim())}
                style={{
                  background: 'linear-gradient(135deg, #52b788, #40916c)',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 24px',
                  fontSize: '14px',
                  color: 'white',
                  cursor: 'pointer',
                  fontWeight: 600,
                  opacity:
                    step === 1 && (!campaignName.trim() || !websiteUrl.trim() || !description.trim())
                      ? 0.5
                      : 1,
                  boxShadow: '0 4px 14px rgba(82,183,136,0.35)',
                }}
              >
                Continue →
              </button>
            )}

            {step === 3 && (
              <button
                onClick={handleGenerate}
                disabled={selectedPlatforms.length === 0 || generating}
                style={{
                  background: 'linear-gradient(135deg, #52b788, #40916c)',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 24px',
                  fontSize: '14px',
                  color: 'white',
                  cursor: selectedPlatforms.length === 0 || generating ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                  opacity: selectedPlatforms.length === 0 || generating ? 0.5 : 1,
                  boxShadow: '0 4px 14px rgba(82,183,136,0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span>✨</span> Generate with AI
              </button>
            )}

            {step === 4 && generated && !generating && (
              <button
                onClick={() => navigate('/campaigns')}
                style={{
                  background: 'linear-gradient(135deg, #52b788, #40916c)',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 24px',
                  fontSize: '14px',
                  color: 'white',
                  cursor: 'pointer',
                  fontWeight: 600,
                  boxShadow: '0 4px 14px rgba(82,183,136,0.35)',
                }}
              >
                Save Campaign ✓
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default CreateCampaign
