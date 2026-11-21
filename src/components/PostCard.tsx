import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { PostRecord } from '../db/schema'
import PlatformBadge from './PlatformBadge'
import StatusBadge from './StatusBadge'
import { PLATFORM_CONFIGS } from '../data/sampleData'

interface Props {
  post: PostRecord
  onStatusChange?: (id: string, status: PostRecord['status']) => void
  onRepublish?: (id: string) => void | Promise<void>
  publishing?: boolean
  publishError?: string
  /**
   * Whether the post's target platform account is connected. When false, the
   * publish and republish buttons are greyed out and disabled. Defaults to
   * true so callers that don't track connection state keep the old behaviour.
   */
  platformConnected?: boolean
  /**
   * Persist an edited post. When provided, the card shows an Edit button.
   * Reject to keep the editor open and show the error.
   */
  onSave?: (id: string, changes: PostEdit) => Promise<void>
}

export interface PostEdit {
  content: string
  hashtags: string[]
}

/** "launch, #saas #saas" → ["#launch", "#saas"] */
function parseHashtags(input: string): string[] {
  const tags = input
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#+/, ''))
    .filter(Boolean)
    .map((t) => `#${t}`)
  return Array.from(new Set(tags))
}

/** The text as it is sent to the platform: body, blank line, hashtags. */
function combinedText(content: string, hashtags: string[]): string {
  return hashtags.length > 0 ? `${content}\n\n${hashtags.join(' ')}` : content
}

function PostCard({
  post,
  onStatusChange,
  onRepublish,
  publishing = false,
  publishError = '',
  platformConnected = true,
  onSave,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [republishing, setRepublishing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [draftTags, setDraftTags] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const config = PLATFORM_CONFIGS.find((p) => p.id === post.platform)
  const isLong = post.content.length > 280
  const isPublishing = publishing && post.status !== 'published'
  const publishDisabled = isPublishing || !platformConnected
  const notConnectedTitle = `Connect ${config?.name ?? post.platform} in Settings to publish`

  const handleCopy = async () => {
    const fullText = post.content + (post.hashtags?.length ? '\n\n' + post.hashtags.join(' ') : '')
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(fullText)
      } else {
        // Fallback for older browsers or non-secure contexts
        const textarea = document.createElement('textarea')
        textarea.value = fullText
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('[PostCard] Failed to copy:', err)
      // Show error feedback
      setCopied(false)
    }
  }

  const handleRepublish = async () => {
    if (!onRepublish || post.status !== 'published' || !platformConnected) return
    setRepublishing(true)
    try {
      await onRepublish(post.id)
    } finally {
      setRepublishing(false)
    }
  }

  const startEditing = () => {
    setDraftText(post.content)
    setDraftTags((post.hashtags ?? []).join(' '))
    setSaveError('')
    setEditing(true)
  }

  const cancelEditing = () => {
    setEditing(false)
    setSaveError('')
  }

  const draft: PostEdit = { content: draftText.trim(), hashtags: parseHashtags(draftTags) }
  const draftLength = combinedText(draft.content, draft.hashtags).length
  const overLimit = config ? draftLength > config.charLimit : false
  const unchanged =
    draft.content === post.content &&
    draft.hashtags.join(' ') === (post.hashtags ?? []).join(' ')
  const saveDisabled = saving || draft.content === '' || unchanged

  const handleSave = async () => {
    if (!onSave || saveDisabled) return
    setSaving(true)
    setSaveError('')
    try {
      await onSave(post.id, draft)
      setEditing(false)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save the post')
    } finally {
      setSaving(false)
    }
  }

  const handleEditorKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') cancelEditing()
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleSave()
  }

  const displayContent = expanded || !isLong ? post.content : post.content.slice(0, 280) + '…'

  return (
    <div
      style={{
        background: 'var(--panel)',
        borderRadius: '12px',
        border: '1px solid var(--line)',
        overflow: 'hidden',
        transition: 'box-shadow 0.2s',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: '1px solid var(--line-soft)',
          background: 'var(--sunken)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <PlatformBadge platform={post.platform} size="md" />
          <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--ink)' }}>
            {config?.name ?? post.platform}
          </span>
          {config && (
            <span style={{ color: 'var(--muted)', fontSize: '12px' }}>
              {post.content.length}/{config.charLimit} chars
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <StatusBadge status={post.status} size="sm" />
          {onSave && !editing && (
            <button
              onClick={startEditing}
              style={{
                background: 'var(--sunken)',
                border: '1px solid var(--line)',
                borderRadius: '6px',
                padding: '4px 10px',
                fontSize: '12px',
                color: 'var(--muted)',
                cursor: 'pointer',
                fontWeight: 500,
                transition: 'all 0.15s',
              }}
            >
              Edit
            </button>
          )}
          <button
            onClick={handleCopy}
            style={{
              background: copied ? 'var(--ok-soft)' : 'var(--sunken)',
              border: `1px solid ${copied ? 'var(--ok-line)' : 'var(--line)'}`,
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '12px',
              color: copied ? 'var(--ok)' : 'var(--muted)',
              cursor: 'pointer',
              fontWeight: 500,
              transition: 'all 0.15s',
            }}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          {post.status === 'published' && !editing && (
            <button
              onClick={handleRepublish}
              disabled={republishing || !platformConnected}
              title={!platformConnected ? notConnectedTitle : undefined}
              style={{
                background: republishing || !platformConnected ? 'var(--line)' : 'var(--sunken)',
                border: '1px solid var(--line)',
                borderRadius: '6px',
                padding: '4px 10px',
                fontSize: '12px',
                color: republishing || !platformConnected ? 'var(--muted)' : 'var(--muted)',
                cursor: republishing || !platformConnected ? 'not-allowed' : 'pointer',
                fontWeight: 500,
                transition: 'all 0.15s',
              }}
            >
              {republishing ? 'Republishing…' : 'Republish'}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '16px' }}>
        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {post.status === 'published' && (
              <div
                style={{
                  background: 'var(--warn-soft)',
                  border: '1px solid var(--warn-line)',
                  borderRadius: '6px',
                  padding: '8px 10px',
                  fontSize: '12px',
                  color: 'var(--warn)',
                }}
              >
                This post is already published. The live post won’t change; use Republish after
                saving to post the new text.
              </div>
            )}
            <textarea
              aria-label="Post text"
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={handleEditorKeyDown}
              autoFocus
              rows={Math.min(Math.max(draftText.split('\n').length + 1, 5), 16)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                border: '1px solid var(--line)',
                borderRadius: '8px',
                padding: '10px 12px',
                fontSize: '14px',
                lineHeight: '1.65',
                color: 'var(--ink)',
                background: 'var(--panel)',
                fontFamily: 'inherit',
                resize: 'vertical',
              }}
            />
            <label
              htmlFor={`hashtags-${post.id}`}
              style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}
            >
              Hashtags
            </label>
            <input
              id={`hashtags-${post.id}`}
              type="text"
              value={draftTags}
              onChange={(e) => setDraftTags(e.target.value)}
              onKeyDown={handleEditorKeyDown}
              placeholder="#launch #productivity"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                border: '1px solid var(--line)',
                borderRadius: '8px',
                padding: '8px 12px',
                fontSize: '13px',
                color: 'var(--ink)',
                background: 'var(--panel)',
                fontFamily: 'inherit',
                marginTop: '-4px',
              }}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
                justifyContent: 'flex-end',
              }}
            >
              {config && (
                <span
                  style={{
                    marginRight: 'auto',
                    fontSize: '12px',
                    color: overLimit ? 'var(--fail)' : 'var(--muted)',
                    fontWeight: overLimit ? 600 : 400,
                  }}
                >
                  <span>
                    {draftLength}/{config.charLimit} chars
                  </span>
                  {overLimit && <span> · over the limit, will be shortened when published</span>}
                </span>
              )}
              {saveError && (
                <span style={{ color: 'var(--fail)', fontSize: '12px' }}>⚠ {saveError}</span>
              )}
              <button
                onClick={cancelEditing}
                disabled={saving}
                style={{
                  background: 'var(--sunken)',
                  border: '1px solid var(--line)',
                  borderRadius: '6px',
                  padding: '6px 14px',
                  fontSize: '13px',
                  color: 'var(--muted)',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  fontWeight: 500,
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saveDisabled}
                style={{
                  background: saveDisabled ? 'var(--off)' : 'var(--primary)',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '6px 14px',
                  fontSize: '13px',
                  color: 'var(--on-primary)',
                  cursor: saveDisabled ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                  opacity: saveDisabled ? 0.7 : 1,
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <>
        <p
          style={{
            color: 'var(--ink-2)',
            fontSize: '14px',
            lineHeight: '1.65',
            whiteSpace: 'pre-line',
            margin: 0,
          }}
        >
          {displayContent}
        </p>
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              fontSize: '13px',
              cursor: 'pointer',
              padding: '4px 0',
              marginTop: '4px',
              fontWeight: 500,
            }}
          >
            {expanded ? 'Show less ↑' : 'Show more ↓'}
          </button>
        )}

        {/* Hashtags */}
        {post.hashtags && post.hashtags.length > 0 && (
          <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {post.hashtags.map((tag) => (
              <span
                key={tag}
                style={{
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                  borderRadius: '4px',
                  padding: '2px 8px',
                  fontSize: '12px',
                  fontWeight: 500,
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
          </>
        )}

        {/* Engagements */}
        {post.engagements && (
          <div
            style={{
              marginTop: '14px',
              paddingTop: '14px',
              borderTop: '1px solid var(--line-soft)',
              display: 'flex',
              gap: '20px',
            }}
          >
            {[
              { icon: '❤️', value: post.engagements.likes, label: 'Likes' },
              { icon: '💬', value: post.engagements.comments, label: 'Comments' },
              { icon: '🔁', value: post.engagements.shares, label: 'Shares' },
              { icon: '👁️', value: post.engagements.views, label: 'Views' },
            ].map(({ icon, value, label }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ink)' }}>
                  {icon} {value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Schedule info */}
        {post.scheduledAt && !post.publishedAt && (
          <div
            style={{
              marginTop: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: 'var(--warn)',
              fontSize: '12px',
              background: 'var(--warn-soft)',
              border: '1px solid var(--warn-line)',
              borderRadius: '6px',
              padding: '6px 10px',
            }}
          >
            <span>📅</span>
            <span>
              Scheduled for{' '}
              {new Date(post.scheduledAt).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      {post.status !== 'published' && !editing && (
        <div
          style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--line-soft)',
            display: 'flex',
            gap: '8px',
            justifyContent: 'flex-end',
            alignItems: 'center',
          }}
        >
          {post.status === 'draft' && (
            <>
              <button
                style={{
                  background: 'var(--sunken)',
                  border: '1px solid var(--line)',
                  borderRadius: '6px',
                  padding: '6px 14px',
                  fontSize: '13px',
                  color: 'var(--muted)',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Schedule
              </button>
              <button
                onClick={() => onStatusChange?.(post.id, 'published')}
                disabled={publishDisabled}
                title={!platformConnected ? notConnectedTitle : undefined}
                style={{
                  background: publishDisabled ? 'var(--off)' : 'var(--primary)',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '6px 14px',
                  fontSize: '13px',
                  color: 'var(--on-primary)',
                  cursor: publishDisabled ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                  opacity: publishDisabled ? 0.7 : 1,
                }}
              >
                {isPublishing ? 'Publishing…' : 'Publish Now'}
              </button>
            </>
          )}
          {post.status === 'scheduled' && (
            <button
              onClick={() => onStatusChange?.(post.id, 'published')}
              disabled={publishDisabled}
              title={!platformConnected ? notConnectedTitle : undefined}
              style={{
                background: publishDisabled ? 'var(--off)' : 'var(--primary)',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 14px',
                fontSize: '13px',
                color: 'var(--on-primary)',
                cursor: publishDisabled ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                opacity: publishDisabled ? 0.7 : 1,
              }}
            >
              {isPublishing ? 'Publishing…' : 'Publish Now'}
            </button>
          )}
          {publishError && (
            <span style={{ color: 'var(--fail)', fontSize: '12px', marginRight: '8px' }}>
              ⚠ {publishError}
            </span>
          )}
        </div>
      )}

      {/* Republish errors — the actions footer above only renders for
          unpublished posts, so surface failures here for published ones. */}
      {post.status === 'published' && publishError && !editing && (
        <div
          style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--line-soft)',
            textAlign: 'right',
          }}
        >
          <span style={{ color: 'var(--fail)', fontSize: '12px' }}>⚠ {publishError}</span>
        </div>
      )}
    </div>
  )
}

export default PostCard
