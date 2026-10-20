import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CampaignStatus } from '../types'
import type { CampaignRecord } from '../db/schema'
import { useCampaigns } from '../hooks/useCampaigns'
import PlatformBadge from '../components/PlatformBadge'
import StatusBadge from '../components/StatusBadge'

const STATUS_FILTERS: { label: string; value: CampaignStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Published', value: 'published' },
  { label: 'Ready', value: 'ready' },
  { label: 'Draft', value: 'draft' },
  { label: 'Generating', value: 'generating' },
]

function CampaignCard({ campaign }: { campaign: CampaignRecord }) {
  const navigate = useNavigate()
  const publishedPosts = campaign.posts.filter((p) => p.status === 'published')
  const totalEngagements = campaign.posts.reduce((sum, p) => {
    const e = p.engagements
    return sum + (e ? e.likes + e.comments + e.shares : 0)
  }, 0)

  return (
    <div
      onClick={() => navigate(`/campaigns/${campaign.id}`)}
      style={{
        background: 'var(--panel)',
        borderRadius: '12px',
        border: '1px solid var(--line)',
        padding: '20px',
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLDivElement
        el.style.borderColor = 'var(--accent-line)'
        el.style.boxShadow = '0 4px 16px var(--accent-soft)'
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLDivElement
        el.style.borderColor = 'var(--line)'
        el.style.boxShadow = 'none'
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3
            style={{
              fontSize: '15px',
              fontWeight: 700,
              color: 'var(--ink)',
              marginBottom: '4px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {campaign.name}
          </h3>
          <a
            href={campaign.websiteUrl}
            onClick={(e) => e.stopPropagation()}
            style={{ fontSize: '12px', color: 'var(--accent)', textDecoration: 'none' }}
          >
            {campaign.websiteUrl}
          </a>
        </div>
        <StatusBadge status={campaign.status} size="sm" pulse={campaign.status === 'generating'} />
      </div>

      {/* Description */}
      <p
        style={{
          fontSize: '13px',
          color: 'var(--muted)',
          lineHeight: 1.5,
          marginBottom: '14px',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {campaign.description}
      </p>

      {/* Platforms */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
        {campaign.platforms.map((p) => (
          <PlatformBadge key={p} platform={p} size="sm" />
        ))}
      </div>

      {/* Stats row */}
      <div
        style={{
          display: 'flex',
          gap: '0',
          paddingTop: '14px',
          borderTop: '1px solid var(--line-soft)',
        }}
      >
        {[
          { label: 'Posts', value: campaign.posts.length },
          { label: 'Published', value: publishedPosts.length },
          { label: 'Engagements', value: totalEngagements > 0 ? (totalEngagements >= 1000 ? `${(totalEngagements / 1000).toFixed(1)}k` : totalEngagements) : '—' },
          {
            label: 'Created',
            value: new Date(campaign.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          },
        ].map(({ label, value }, i, arr) => (
          <div
            key={label}
            style={{
              flex: 1,
              textAlign: 'center',
              borderRight: i < arr.length - 1 ? '1px solid var(--line-soft)' : 'none',
            }}
          >
            <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ink)' }}>{value}</div>
            <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CampaignList() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<CampaignStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const { campaigns, loading, error } = useCampaigns()

  const filtered = campaigns.filter((c) => {
    const matchStatus = filter === 'all' || c.status === filter
    const matchSearch =
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.websiteUrl.toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  return (
    <div style={{ padding: '32px' }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '28px' }}>
        <div>
          <h1 style={{ fontSize: '30px', fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>
            Campaigns
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '14px' }}>
            {loading ? 'Loading…' : `${campaigns.length} campaign${campaigns.length !== 1 ? 's' : ''} total`}
          </p>
        </div>
        <button
          onClick={() => navigate('/create')}
          style={{
            background: 'var(--primary)',
            border: 'none',
            borderRadius: '10px',
            padding: '10px 20px',
            color: 'var(--on-primary)',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: 'none',
          }}
        >
          <span>✨</span> New Campaign
        </button>
      </div>

      {/* Filters */}
      <div
        style={{
          display: 'flex',
          gap: '12px',
          marginBottom: '24px',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        {/* Search */}
        <div style={{ position: 'relative', flex: '1', minWidth: '200px', maxWidth: '320px' }}>
          <span
            style={{
              position: 'absolute',
              left: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--muted)',
              fontSize: '14px',
            }}
          >
            🔍
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search campaigns…"
            style={{
              width: '100%',
              padding: '9px 14px 9px 36px',
              borderRadius: '8px',
              border: '1px solid var(--line)',
              fontSize: '14px',
              outline: 'none',
              background: 'var(--panel)',
            }}
          />
        </div>

        {/* Status filters */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              style={{
                padding: '7px 14px',
                borderRadius: '8px',
                border: `1px solid ${filter === value ? 'var(--accent)' : 'var(--line)'}`,
                background: filter === value ? 'var(--accent-soft)' : 'var(--panel)',
                color: filter === value ? 'var(--accent)' : 'var(--muted)',
                fontSize: '13px',
                fontWeight: filter === value ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div
          style={{
            textAlign: 'center',
            padding: '80px 40px',
            background: 'var(--panel)',
            borderRadius: '12px',
            border: '1px solid var(--line)',
          }}
        >
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
          <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Loading campaigns…</p>
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div
          style={{
            textAlign: 'center',
            padding: '60px 40px',
            background: 'var(--fail-soft)',
            borderRadius: '12px',
            border: '1px solid var(--fail-line)',
          }}
        >
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚠️</div>
          <p style={{ color: 'var(--fail)', fontSize: '14px' }}>{error}</p>
        </div>
      )}

      {/* Campaign grid */}
      {!loading && !error && (
        filtered.length > 0 ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
              gap: '16px',
            }}
          >
            {filtered.map((campaign) => (
              <CampaignCard key={campaign.id} campaign={campaign} />
            ))}
          </div>
        ) : (
          <div
            style={{
              textAlign: 'center',
              padding: '80px 40px',
              background: 'var(--panel)',
              borderRadius: '12px',
              border: '1px solid var(--line)',
            }}
          >
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📭</div>
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--ink)', marginBottom: '8px' }}>
              No campaigns found
            </h3>
            <p style={{ color: 'var(--muted)', fontSize: '14px', marginBottom: '20px' }}>
              {search ? `No campaigns match "${search}"` : 'Create your first campaign to get started.'}
            </p>
            <button
              onClick={() => navigate('/create')}
              style={{
                background: 'var(--primary)',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 24px',
                color: 'var(--on-primary)',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Create Campaign
            </button>
          </div>
        )
      )}
    </div>
  )
}

export default CampaignList
