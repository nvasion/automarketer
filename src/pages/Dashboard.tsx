import { useNavigate } from 'react-router-dom'
import { PLATFORM_CONFIGS } from '../data/sampleData'
import PlatformBadge from '../components/PlatformBadge'
import StatusBadge from '../components/StatusBadge'
import { useCampaigns, useCampaignStats } from '../hooks/useCampaigns'
import type { CampaignRecord } from '../db/schema'
import type { Platform } from '../types'

function CampaignRow({ campaign }: { campaign: CampaignRecord }) {
  const navigate = useNavigate()

  return (
    <tr
      onClick={() => navigate(`/campaigns/${campaign.id}`)}
      style={{ cursor: 'pointer', transition: 'background 0.1s' }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = 'var(--sunken)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = 'transparent')}
    >
      <td style={{ padding: '14px 16px', borderBottom: '1px solid var(--line-soft)' }}>
        <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--ink)' }}>{campaign.name}</div>
        <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>{campaign.websiteUrl}</div>
      </td>
      <td style={{ padding: '14px 16px', borderBottom: '1px solid var(--line-soft)' }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          {campaign.platforms.map((p) => (
            <PlatformBadge key={p} platform={p} size="sm" />
          ))}
        </div>
      </td>
      <td style={{ padding: '14px 16px', borderBottom: '1px solid var(--line-soft)' }}>
        <StatusBadge status={campaign.status} size="sm" pulse={campaign.status === 'generating'} />
      </td>
      <td style={{ padding: '14px 16px', borderBottom: '1px solid var(--line-soft)', color: 'var(--muted)', fontSize: '13px' }}>
        {campaign.posts.length} posts
      </td>
      <td style={{ padding: '14px 16px', borderBottom: '1px solid var(--line-soft)', color: 'var(--muted)', fontSize: '13px' }}>
        {new Date(campaign.createdAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })}
      </td>
    </tr>
  )
}

function Dashboard() {
  const navigate = useNavigate()
  const { campaigns, loading: campaignsLoading } = useCampaigns()
  const { stats } = useCampaignStats()

  const statCards = [
    {
      label: 'Total Campaigns',
      value: stats?.totalCampaigns ?? '—',
      icon: '📢',
      color: 'var(--accent)',
      bg: 'var(--accent-soft)',
    },
    {
      label: 'Posts Published',
      value: stats?.totalPostsPublished ?? '—',
      icon: '✅',
      color: 'var(--ok)',
      bg: 'var(--ok-soft)',
    },
    {
      label: 'Total Engagements',
      value: stats
        ? stats.totalEngagements >= 1000
          ? `${(stats.totalEngagements / 1000).toFixed(1)}k`
          : String(stats.totalEngagements)
        : '—',
      icon: '🔥',
      color: 'var(--warn)',
      bg: 'var(--warn-soft)',
    },
    {
      label: 'Avg. Engagement Rate',
      value: stats ? `${stats.avgEngagementRate}%` : '—',
      icon: '📈',
      color: 'var(--accent)',
      bg: 'var(--accent-soft)',
    },
  ]

  // Compute platform performance from real campaign data
  const platformPerformance = PLATFORM_CONFIGS.map((cfg) => {
    const posts = campaigns.flatMap((c) => c.posts).filter((p) => p.platform === cfg.id)
    const engagements = posts
      .filter((p) => p.engagements)
      .reduce(
        (sum, p) =>
          sum + (p.engagements?.likes ?? 0) + (p.engagements?.comments ?? 0) + (p.engagements?.shares ?? 0),
        0
      )
    return { platform: cfg.id as Platform, cfg, posts: posts.length, engagements }
  }).filter((p) => p.posts > 0)

  const maxEngagements = Math.max(...platformPerformance.map((p) => p.engagements), 1)

  return (
    <div style={{ padding: '32px 32px 48px' }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '30px', fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>
            Dashboard
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '14px' }}>
            Welcome back! Here's your marketing overview.
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

      {/* Stat cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '16px',
          marginBottom: '32px',
        }}
      >
        {statCards.map((card) => (
          <div
            key={card.label}
            style={{
              background: 'var(--panel)',
              borderRadius: '12px',
              border: '1px solid var(--line)',
              padding: '20px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ color: 'var(--muted)', fontSize: '13px', fontWeight: 500 }}>{card.label}</span>
              <span
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  backgroundColor: card.bg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '16px',
                }}
              >
                {card.icon}
              </span>
            </div>
            <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--ink)' }}>
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Main content grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '24px' }}>
        {/* Recent campaigns */}
        <div
          style={{
            background: 'var(--panel)',
            borderRadius: '12px',
            border: '1px solid var(--line)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--line-soft)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--ink)' }}>Recent Campaigns</h2>
            <button
              onClick={() => navigate('/campaigns')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent)',
                fontSize: '13px',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              View all →
            </button>
          </div>
          {campaignsLoading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              Loading campaigns…
            </div>
          ) : campaigns.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)', fontSize: '14px' }}>
              No campaigns yet.{' '}
              <span
                onClick={() => navigate('/create')}
                style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 500 }}
              >
                Create your first campaign →
              </span>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--sunken)' }}>
                  {['Campaign', 'Platforms', 'Status', 'Posts', 'Created'].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '10px 16px',
                        textAlign: 'left',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: 'var(--muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        borderBottom: '1px solid var(--line-soft)',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {campaigns.slice(0, 5).map((campaign) => (
                  <CampaignRow key={campaign.id} campaign={campaign} />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Right sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Platform performance */}
          <div
            style={{
              background: 'var(--panel)',
              borderRadius: '12px',
              border: '1px solid var(--line)',
              padding: '20px',
            }}
          >
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ink)', marginBottom: '16px' }}>
              Platform Performance
            </h3>
            {platformPerformance.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: '13px', textAlign: 'center', padding: '16px 0' }}>
                No engagement data yet.
              </div>
            ) : (
              platformPerformance.map(({ platform, cfg, engagements, posts }) => {
                const pct = Math.round((engagements / maxEngagements) * 100)
                return (
                  <div key={platform} style={{ marginBottom: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <PlatformBadge platform={platform} size="sm" />
                        <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--ink-2)' }}>{cfg.name}</span>
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                        {engagements >= 1000 ? `${(engagements / 1000).toFixed(1)}k` : engagements} engagements
                      </span>
                    </div>
                    <div style={{ height: '6px', background: 'var(--chip)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${pct}%`,
                          background: cfg.bgColor ?? 'var(--primary)',
                          borderRadius: '3px',
                          transition: 'width 0.8s ease',
                        }}
                      />
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '3px' }}>{posts} posts</div>
                  </div>
                )
              })
            )}
          </div>

          {/* Quick actions */}
          <div
            style={{
              background: 'var(--panel)',
              borderRadius: '12px',
              border: '1px solid var(--line)',
              padding: '20px',
            }}
          >
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ink)', marginBottom: '14px' }}>
              Quick Actions
            </h3>
            {[
              { icon: '✨', label: 'Create New Campaign', action: () => navigate('/create'), primary: true },
              { icon: '📅', label: 'View Schedule', action: () => navigate('/scheduler'), primary: false },
              { icon: '📊', label: 'View Analytics', action: () => navigate('/analytics'), primary: false },
            ].map(({ icon, label, action, primary }) => (
              <button
                key={label}
                onClick={action}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: primary ? 'none' : '1px solid var(--line)',
                  background: primary ? 'var(--primary)' : 'var(--sunken)',
                  color: primary ? 'var(--on-primary)' : 'var(--ink-2)',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  marginBottom: '8px',
                  textAlign: 'left',
                  transition: 'all 0.15s',
                }}
              >
                <span>{icon}</span>
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
