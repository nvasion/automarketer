import { useState } from 'react'
import type { PostRecord } from '../db/schema'
import PlatformBadge from './PlatformBadge'
import StatusBadge from './StatusBadge'
import { PLATFORM_CONFIGS } from '../data/sampleData'

interface Props {
  post: PostRecord
  onStatusChange?: (id: string, status: PostRecord['status']) => void
}

function PostCard({ post, onStatusChange }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const config = PLATFORM_CONFIGS.find((p) => p.id === post.platform)
  const isLong = post.content.length > 280

  const handleCopy = () => {
    const fullText = post.content + (post.hashtags?.length ? '\n\n' + post.hashtags.join(' ') : '')
    navigator.clipboard.writeText(fullText).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const displayContent = expanded || !isLong ? post.content : post.content.slice(0, 280) + '…'

  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
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
          borderBottom: '1px solid #f1f5f9',
          background: '#fafbfc',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <PlatformBadge platform={post.platform} size="md" />
          <span style={{ fontWeight: 600, fontSize: '14px', color: '#1e293b' }}>
            {config?.name ?? post.platform}
          </span>
          {config && (
            <span style={{ color: '#94a3b8', fontSize: '12px' }}>
              {post.content.length}/{config.charLimit} chars
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <StatusBadge status={post.status} size="sm" />
          <button
            onClick={handleCopy}
            style={{
              background: copied ? '#f0fdf4' : '#f8fafc',
              border: `1px solid ${copied ? '#bbf7d0' : '#e2e8f0'}`,
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '12px',
              color: copied ? '#16a34a' : '#64748b',
              cursor: 'pointer',
              fontWeight: 500,
              transition: 'all 0.15s',
            }}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '16px' }}>
        <p
          style={{
            color: '#334155',
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
              color: '#6366f1',
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
                  background: '#eff6ff',
                  color: '#3b82f6',
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

        {/* Engagements */}
        {post.engagements && (
          <div
            style={{
              marginTop: '14px',
              paddingTop: '14px',
              borderTop: '1px solid #f1f5f9',
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
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#1e293b' }}>
                  {icon} {value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>{label}</div>
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
              color: '#a16207',
              fontSize: '12px',
              background: '#fefce8',
              border: '1px solid #fef08a',
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
      {post.status !== 'published' && (
        <div
          style={{
            padding: '10px 16px',
            borderTop: '1px solid #f1f5f9',
            display: 'flex',
            gap: '8px',
            justifyContent: 'flex-end',
          }}
        >
          {post.status === 'draft' && (
            <>
              <button
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  padding: '6px 14px',
                  fontSize: '13px',
                  color: '#64748b',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Schedule
              </button>
              <button
                onClick={() => onStatusChange?.(post.id, 'published')}
                style={{
                  background: '#6366f1',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '6px 14px',
                  fontSize: '13px',
                  color: 'white',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Publish Now
              </button>
            </>
          )}
          {post.status === 'scheduled' && (
            <button
              onClick={() => onStatusChange?.(post.id, 'published')}
              style={{
                background: '#6366f1',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 14px',
                fontSize: '13px',
                color: 'white',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Publish Now
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default PostCard
