/**
 * Tests for direct editing of generated posts in CreateCampaign.
 *
 * After AI generation (or the no-key template fallback), users must be able to
 * edit the post text directly in the textarea. The textarea is a *controlled*
 * component bound to `generatedPosts` state so that:
 *   - edits are captured into state (and saved on "Save Campaign"),
 *   - the live character counter reflects edits,
 *   - platform-specific character limits are enforced, and
 *   - edits persist across regeneration.
 *
 * Mock strategy
 * ─────────────
 *  - `useContentGeneration` is mocked so we can drive the AI-success path
 *    deterministically without a real inference client.
 *  - `loadAIConfig` is mocked with a function that reads a module-level
 *    `hasApiKey` flag, letting individual tests toggle between the template
 *    fallback path (no key → 1400 ms setTimeout) and the real AI path
 *    (key present → `generate()` is called).
 *  - `createCampaign` is mocked so we can assert what content is saved and
 *    avoid hitting the network.
 *  - `uploadImage` is mocked so accidental file uploads never reach the server.
 *
 * Note on relative paths: this file lives in `tests/`, so module mocks must
 * use `../src/...` (one level up to the repo root), NOT `../../src/...`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { GeneratedPostDraft } from '../src/services/ai'
import type { Platform } from '../src/types'

// ─── Module mocks ────────────────────────────────────────────────────────────

const mockGenerate = vi.fn(
  // Default no-op implementation returns an empty drafts array so an unconfigured
  // test fails predictably instead of throwing "not iterable" inside the
  // component. Individual tests override with mockResolvedValueOnce.
  (): GeneratedPostDraft[] => [],
)
const mockClearError = vi.fn()
const mockErrorRef = { current: null as string | null }

vi.mock('../src/hooks/useContentGeneration', () => ({
  useContentGeneration: () => ({
    generate: mockGenerate,
    error: mockErrorRef.current,
    clearError: mockClearError,
  }),
}))

// `createCampaign` posts to the server; mock it so we can assert what content
// is saved and avoid hitting the network.
const mockCreateCampaign = vi.fn()

vi.mock('../src/api/campaigns', () => ({
  createCampaign: (...args: unknown[]) => mockCreateCampaign(...args),
}))

// Image upload should never run during these tests.
vi.mock('../src/services/mediaService', () => ({
  uploadImage: vi.fn(),
}))

/**
 * Configurable AI config mock. Tests flip `hasApiKey` to choose between the
 * template-fallback path (false) and the real-AI path (true). Keeping the flag
 * in a mutable object lets the mock read the current value at call time.
 */
const aiConfigState = { hasApiKey: false }

vi.mock('../src/config/aiConfig', () => ({
  loadAIConfig: () => ({
    provider: 'openrouter',
    providers: {
      openrouter: {
        apiKey: aiConfigState.hasApiKey ? 'test-key' : '',
        model: 'gpt-4o-mini',
        baseUrl: '',
      },
      custom: { apiKey: '', model: '', baseUrl: '' },
    },
    defaults: {
      tone: 'professional',
      emojiUsage: 'moderate',
      autoHashtags: true,
      maxTokens: 1024,
      temperature: 0.7,
    },
  }),
}))

// ─── Imports after mocks ─────────────────────────────────────────────────────

import CreateCampaign from '../src/pages/CreateCampaign'
import { PLATFORM_CONFIGS } from '../src/data/sampleData'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Render CreateCampaign inside a router (required by useNavigate). */
function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/create']}>
      <CreateCampaign />
    </MemoryRouter>,
  )
}

/**
 * Drive the wizard through steps 1–3 and click "Generate with AI".
 *
 * `platforms` controls which platforms end up selected. The component defaults
 * to `['linkedin', 'twitter']`, so we first deselect those defaults, then
 * select the requested set. Clicking a platform tile toggles its membership, so
 * we only toggle the platforms that differ from the desired final set (toggling
 * an already-desired platform would deselect it).
 */
function fillWizardAndClickGenerate(platforms: Platform[]): void {
  renderPage()

  // Step 1: website info
  fireEvent.change(screen.getByPlaceholderText('e.g. Q2 Product Launch'), {
    target: { value: 'Test Campaign' },
  })
  fireEvent.change(screen.getByPlaceholderText('https://yourproduct.com'), {
    target: { value: 'https://example.com' },
  })
  fireEvent.change(
    screen.getByPlaceholderText(/Briefly describe what you're promoting/),
    { target: { value: 'A great product.' } },
  )
  fireEvent.click(screen.getByText('Continue →'))

  // Step 2: screenshots — skip
  fireEvent.click(screen.getByText('Continue →'))

  // Step 3: platforms & tone. The default selection is linkedin + twitter.
  // Toggle each platform whose membership must change to reach the desired set.
  const desired = new Set<Platform>(platforms)
  for (const p of PLATFORM_CONFIGS) {
    const isDefaultSelected = p.id === 'linkedin' || p.id === 'twitter'
    const wantSelected = desired.has(p.id)
    if (isDefaultSelected !== wantSelected) {
      fireEvent.click(screen.getByText(p.name))
    }
  }

  fireEvent.click(screen.getByText(/Generate with AI/))
}

/** Find the textarea labelled for a given platform. */
function getPostTextarea(platform: Platform): HTMLTextAreaElement {
  const cfg = PLATFORM_CONFIGS.find((p) => p.id === platform)!
  return screen.getByLabelText(`Edit ${cfg.name} post`) as HTMLTextAreaElement
}

/**
 * Wait for the review step's post textareas to appear after generation.
 * Uses real timers with an extended timeout so the fallback path's 1400 ms
 * delay (and any microtask settling) completes before the assertion.
 */
async function waitForReviewStep(platform: Platform): Promise<void> {
  await waitFor(
    () => {
      expect(getPostTextarea(platform)).toBeDefined()
    },
    { timeout: 5000 },
  )
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CreateCampaign — editing generated posts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockErrorRef.current = null
    aiConfigState.hasApiKey = false
    mockGenerate.mockReset()
    mockCreateCampaign.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Controlled textarea + char counter ────────────────────────────────────

  it('renders an editable textarea for each generated platform', async () => {
    fillWizardAndClickGenerate(['linkedin', 'twitter'])
    await waitForReviewStep('linkedin')

    const li = getPostTextarea('linkedin')
    const tw = getPostTextarea('twitter')
    expect(li).toBeDefined()
    expect(tw).toBeDefined()
    // The fallback templates are non-empty, so the textareas start populated.
    expect(li.value.length).toBeGreaterThan(0)
    expect(tw.value.length).toBeGreaterThan(0)
  })

  it('updates the live character counter as the user edits', async () => {
    fillWizardAndClickGenerate(['twitter'])
    await waitForReviewStep('twitter')

    const cfg = PLATFORM_CONFIGS.find((p) => p.id === 'twitter')!
    const textarea = getPostTextarea('twitter')
    const initialCount = textarea.value.length
    expect(screen.getByText(`${initialCount}/${cfg.charLimit} chars`)).toBeDefined()

    // Append text and confirm the counter reflects the new length.
    fireEvent.change(textarea, { target: { value: 'A short tweet.' } })
    const newCount = 'A short tweet.'.length
    expect(screen.getByText(`${newCount}/${cfg.charLimit} chars`)).toBeDefined()
  })

  it('enforces platform-specific character limits via maxLength', async () => {
    fillWizardAndClickGenerate(['twitter', 'linkedin'])
    await waitForReviewStep('twitter')

    const tw = getPostTextarea('twitter')
    const li = getPostTextarea('linkedin')
    const twLimit = PLATFORM_CONFIGS.find((p) => p.id === 'twitter')!.charLimit
    const liLimit = PLATFORM_CONFIGS.find((p) => p.id === 'linkedin')!.charLimit

    expect(tw.maxLength).toBe(twLimit)
    expect(li.maxLength).toBe(liLimit)
    // Limits differ across platforms (proves platform-specific enforcement).
    expect(twLimit).not.toBe(liLimit)
  })

  it('marks the character counter red when the content exceeds the limit', async () => {
    fillWizardAndClickGenerate(['twitter'])
    await waitForReviewStep('twitter')

    const cfg = PLATFORM_CONFIGS.find((p) => p.id === 'twitter')!
    const textarea = getPostTextarea('twitter')

    // Exactly at the limit → counter is NOT red.
    fireEvent.change(textarea, { target: { value: 'x'.repeat(cfg.charLimit) } })
    const counterAtLimit = screen.getByText(`${cfg.charLimit}/${cfg.charLimit} chars`)
    expect(counterAtLimit.style.color).not.toBe('rgb(220, 38, 38)')

    // jsdom does NOT enforce maxLength on fireEvent.change, so we can drive the
    // component's isOverLimit branch by setting a value beyond the limit. The
    // controlled state stores the full value and the counter turns red.
    fireEvent.change(textarea, { target: { value: 'x'.repeat(cfg.charLimit + 5) } })
    const counterOverLimit = screen.getByText(`${cfg.charLimit + 5}/${cfg.charLimit} chars`)
    expect(counterOverLimit.style.color).toBe('rgb(220, 38, 38)')
  })

  // ── State persistence + save ───────────────────────────────────────────────

  it('persists user edits into state and saves them on "Save Campaign"', async () => {
    fillWizardAndClickGenerate(['twitter'])
    await waitForReviewStep('twitter')

    const textarea = getPostTextarea('twitter')
    const edited = 'My hand-edited tweet content.'
    fireEvent.change(textarea, { target: { value: edited } })

    // Mock createCampaign to resolve with a record so navigation proceeds.
    mockCreateCampaign.mockResolvedValueOnce({ id: 'camp-test-1' })

    fireEvent.click(screen.getByText('Save Campaign ✓'))

    await waitFor(() => {
      expect(mockCreateCampaign).toHaveBeenCalledTimes(1)
    })

    const savedArg = mockCreateCampaign.mock.calls[0][0] as {
      posts: { platform: Platform; content: string }[]
    }
    const twitterPost = savedArg.posts.find((p) => p.platform === 'twitter')
    expect(twitterPost).toBeDefined()
    // The user's edit must be what gets saved — not the original template.
    expect(twitterPost!.content).toBe(edited)
  })

  it('shows a save error and keeps the page mounted when createCampaign rejects', async () => {
    fillWizardAndClickGenerate(['twitter'])
    await waitForReviewStep('twitter')

    mockCreateCampaign.mockRejectedValueOnce(new Error('Server is down'))
    fireEvent.click(screen.getByText('Save Campaign ✓'))

    await waitFor(() => {
      expect(screen.getByText('Server is down')).toBeDefined()
    })
    // The review step (with textareas) must still be present so edits aren't lost.
    expect(getPostTextarea('twitter')).toBeDefined()
  })

  // ── Regeneration semantics (AI path) ───────────────────────────────────────

  it('reflects newly generated content in the textarea (controlled sync)', async () => {
    // Use the real AI path: provide a key so hasInferenceConfig() is true.
    aiConfigState.hasApiKey = true
    mockGenerate.mockResolvedValueOnce([
      { platform: 'linkedin' as Platform, content: 'Initial LinkedIn draft.', hashtags: [] },
    ])

    fillWizardAndClickGenerate(['linkedin'])
    await waitForReviewStep('linkedin')

    expect(getPostTextarea('linkedin').value).toBe('Initial LinkedIn draft.')

    // Editing mutates the same controlled value.
    fireEvent.change(getPostTextarea('linkedin'), {
      target: { value: 'Edited by user.' },
    })
    expect(getPostTextarea('linkedin').value).toBe('Edited by user.')
  })

  it('lets the user edit after a regeneration replaces the draft', async () => {
    // Real AI path: key present → generate() is called.
    aiConfigState.hasApiKey = true
    mockGenerate.mockResolvedValueOnce([
      { platform: 'twitter' as Platform, content: 'AI draft tweet.', hashtags: [] },
    ])

    fillWizardAndClickGenerate(['twitter'])
    await waitForReviewStep('twitter')
    expect(getPostTextarea('twitter').value).toBe('AI draft tweet.')

    // User edits the regenerated draft directly in the text field.
    fireEvent.change(getPostTextarea('twitter'), {
      target: { value: 'Edited after regen.' },
    })
    expect(getPostTextarea('twitter').value).toBe('Edited after regen.')

    // A second regeneration produces different content. Regeneration
    // replaces state with the new draft (expected semantics), and the
    // controlled textarea immediately reflects the new value.
    mockGenerate.mockResolvedValueOnce([
      { platform: 'twitter' as Platform, content: 'Freshly regenerated draft.', hashtags: [] },
    ])

    // Go back to step 3 and regenerate again.
    fireEvent.click(screen.getByText('← Back'))
    fireEvent.click(screen.getByText(/Generate with AI/))
    await waitFor(() => {
      expect(getPostTextarea('twitter').value).toBe('Freshly regenerated draft.')
    })

    // After the new regeneration the user can again edit directly.
    fireEvent.change(getPostTextarea('twitter'), {
      target: { value: 'Final edited version.' },
    })
    expect(getPostTextarea('twitter').value).toBe('Final edited version.')
  })

  it('propagates generation errors and stays on the platforms step for retry', async () => {
    // Real AI path but generate() rejects → component sets step back to 3.
    aiConfigState.hasApiKey = true
    mockErrorRef.current = 'Upstream provider timed out'
    mockGenerate.mockRejectedValueOnce(new Error('Upstream provider timed out'))

    fillWizardAndClickGenerate(['twitter'])

    // The component catches the error and resets to step 3 so the user can
    // see the error banner and retry. The review textareas must NOT be present.
    await waitFor(() => {
      expect(screen.getByText('Platforms & Tone')).toBeDefined()
    })
    expect(screen.queryByLabelText(/Edit .+ post/)).toBeNull()
    // The error banner surfaces the message.
    expect(screen.getByText(/Upstream provider timed out/)).toBeDefined()
  })
})
