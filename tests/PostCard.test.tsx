/**
 * Tests for the PostCard component.
 *
 * Key behaviour verified:
 * - Publish Now / Republish buttons are greyed out (disabled) when the
 *   target platform connection is not set (platformConnected={false})
 * - Buttons stay enabled when the platform is connected (and by default)
 * - Republish invokes onRepublish only when the platform is connected
 * - Republish failures surface the publishError for published posts
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PostCard from '../src/components/PostCard'
import type { PostRecord } from '../src/db/schema'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePost(overrides: Partial<PostRecord> = {}): PostRecord {
  return {
    id: 'post-1',
    platform: 'reddit',
    content: 'Test post content',
    hashtags: [],
    status: 'draft',
    ...overrides,
  }
}

// ─── Publish Now button ───────────────────────────────────────────────────────

describe('PostCard — Publish Now button', () => {
  it('is enabled by default (no platformConnected prop)', () => {
    render(<PostCard post={makePost()} />)
    expect(screen.getByRole('button', { name: 'Publish Now' })).toBeEnabled()
  })

  it('is enabled when the platform is connected', () => {
    render(<PostCard post={makePost()} platformConnected={true} />)
    expect(screen.getByRole('button', { name: 'Publish Now' })).toBeEnabled()
  })

  it('is disabled when the platform is not connected', () => {
    render(<PostCard post={makePost()} platformConnected={false} />)
    expect(screen.getByRole('button', { name: 'Publish Now' })).toBeDisabled()
  })

  it('shows a connect hint in the title when disabled', () => {
    render(<PostCard post={makePost()} platformConnected={false} />)
    expect(screen.getByRole('button', { name: 'Publish Now' })).toHaveAttribute(
      'title',
      expect.stringContaining('Connect'),
    )
  })

  it('is disabled for scheduled posts when the platform is not connected', () => {
    render(
      <PostCard
        post={makePost({ status: 'scheduled', scheduledAt: '2026-07-01T09:00:00Z' })}
        platformConnected={false}
      />,
    )
    expect(screen.getByRole('button', { name: 'Publish Now' })).toBeDisabled()
  })

  it('does not invoke onStatusChange when disabled', () => {
    const onStatusChange = vi.fn()
    render(
      <PostCard post={makePost()} onStatusChange={onStatusChange} platformConnected={false} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Publish Now' }))
    expect(onStatusChange).not.toHaveBeenCalled()
  })
})

// ─── Republish button ─────────────────────────────────────────────────────────

describe('PostCard — Republish button', () => {
  const publishedPost = () =>
    makePost({ status: 'published', publishedAt: '2026-06-01T10:00:00Z' })

  it('is enabled when the platform is connected', () => {
    render(<PostCard post={publishedPost()} onRepublish={() => {}} platformConnected={true} />)
    expect(screen.getByRole('button', { name: 'Republish' })).toBeEnabled()
  })

  it('is disabled when the platform is not connected', () => {
    render(<PostCard post={publishedPost()} onRepublish={() => {}} platformConnected={false} />)
    expect(screen.getByRole('button', { name: 'Republish' })).toBeDisabled()
  })

  it('shows a connect hint in the title when disabled', () => {
    render(<PostCard post={publishedPost()} onRepublish={() => {}} platformConnected={false} />)
    expect(screen.getByRole('button', { name: 'Republish' })).toHaveAttribute(
      'title',
      expect.stringContaining('Connect'),
    )
  })

  it('invokes onRepublish with the post id when connected', async () => {
    const onRepublish = vi.fn().mockResolvedValue(undefined)
    render(<PostCard post={publishedPost()} onRepublish={onRepublish} platformConnected={true} />)
    fireEvent.click(screen.getByRole('button', { name: 'Republish' }))
    await waitFor(() => expect(onRepublish).toHaveBeenCalledWith('post-1'))
  })

  it('does not invoke onRepublish when the platform is not connected', () => {
    const onRepublish = vi.fn()
    render(<PostCard post={publishedPost()} onRepublish={onRepublish} platformConnected={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Republish' }))
    expect(onRepublish).not.toHaveBeenCalled()
  })

  it('surfaces publishError for published posts', () => {
    render(
      <PostCard
        post={publishedPost()}
        onRepublish={() => {}}
        publishError="Reddit API error 503"
      />,
    )
    expect(screen.getByText(/Reddit API error 503/)).toBeInTheDocument()
  })
})

// ─── Editing ──────────────────────────────────────────────────────────────────

describe('PostCard — editing', () => {
  it('shows no Edit button when no onSave handler is given', () => {
    render(<PostCard post={makePost()} />)
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('opens an editor prefilled with the post text and hashtags', () => {
    render(
      <PostCard post={makePost({ content: 'Hello world', hashtags: ['#launch', '#saas'] })} onSave={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Post text')).toHaveValue('Hello world')
    expect(screen.getByLabelText('Hashtags')).toHaveValue('#launch #saas')
    // Publishing controls are hidden while editing
    expect(screen.queryByRole('button', { name: 'Publish Now' })).not.toBeInTheDocument()
  })

  it('saves the edited text and normalised hashtags', async () => {
    const onSave = vi.fn(async () => undefined)
    render(<PostCard post={makePost({ content: 'Old text', hashtags: [] })} onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Post text'), { target: { value: '  New text  ' } })
    fireEvent.change(screen.getByLabelText('Hashtags'), { target: { value: 'launch, #saas #saas' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith('post-1', { content: 'New text', hashtags: ['#launch', '#saas'] }),
    )
    await waitFor(() => expect(screen.queryByLabelText('Post text')).not.toBeInTheDocument())
  })

  it('Cancel discards changes without saving', () => {
    const onSave = vi.fn()
    render(<PostCard post={makePost({ content: 'Keep me' })} onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Post text'), { target: { value: 'Throw away' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Keep me')).toBeInTheDocument()
  })

  it('disables Save when the text is empty or unchanged', () => {
    render(<PostCard post={makePost({ content: 'Same' })} onSave={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Post text'), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('counts text plus hashtags against the platform limit and warns when over', () => {
    // Twitter limit is 280
    render(<PostCard post={makePost({ platform: 'twitter', content: 'x' })} onSave={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Post text'), { target: { value: 'a'.repeat(275) } })
    fireEvent.change(screen.getByLabelText('Hashtags'), { target: { value: '#tag' } })
    // 275 + "\n\n" + "#tag" = 281
    expect(screen.getByText('281/280 chars')).toBeInTheDocument()
    expect(screen.getByText(/shortened when published/i)).toBeInTheDocument()
  })

  it('keeps the editor open and shows the error when saving fails', async () => {
    const onSave = vi.fn(async () => {
      throw new Error('Network down')
    })
    render(<PostCard post={makePost({ content: 'Old' })} onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Post text'), { target: { value: 'New' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/Network down/)).toBeInTheDocument()
    expect(screen.getByLabelText('Post text')).toHaveValue('New')
  })

  it('warns that editing a published post does not change the live one', () => {
    render(
      <PostCard post={makePost({ status: 'published', publishedAt: '2026-11-01T09:00:00Z' })} onSave={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByText(/live post won.t change/i)).toBeInTheDocument()
  })
})
