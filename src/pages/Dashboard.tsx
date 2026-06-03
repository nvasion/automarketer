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
      onMouseEnter={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = '#f8fafc')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = 'transparent')}
    >
      <td style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ fontWeight: 600, fontSize: '14px', color: '#1e293b' }}>{campaign.name}</div>
        <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>{campaign.websiteUrl}</div>
      </td>
      <td style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          {campaign.platforms.map((p) => (
            <PlatformBadge key={p} platform={p} size="sm" />
          ))}
        </div>
      </td>
      <td style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9' }}>
        <StatusBadge status={campaign.status} size="sm" pulse={campaign.status === 'generating'} />
      </td>
      <td style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', color: '#64748b', fontSize: '13px' }}>
        {campaign.posts.length} posts
      </td>
      <td style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', color: '#94a3b8', fontSize: '13px' }}>
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
      color: '#6366f1',
      bg: '#eff0ff',
    },
    {
      label: 'Posts Published',
      value: stats?.totalPostsPublished ?? '—',
      icon: '✅',
      color: '#10b981',
      bg: '#ecfdf5',
    },
    {
      label: 'Total Engagements',
      value: stats
        ? stats.totalEngagements >= 1000
          ? `${(stats.totalEngagements / 1000).toFixed(1)}k`
          : String(stats.totalEngagements)
        : '—',
      icon: '🔥',
      color: '#f59e0b',
      bg: '#fffbeb',
    },
    {
      label: 'Avg. Engagement Rate',
      value: stats ? `${stats.avgEngagementRate}%` : '—',
      icon: '📈',
      color: '#3b82f6',
      bg: '#eff6ff',
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
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
            Dashboard
          </h1>
          <p style={{ color: '#64748b', fontSize: '14px' }}>
            Welcome back! Here's your marketing overview.
          </p>
        </div>
        <button
          onClick={() => navigate('/create')}
          style={{
            background: 'linear-gradient(135deg, #52b788, #40916c)',
            border: 'none',
            borderRadius: '10px',
            padding: '10px 20px',
            color: 'white',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: '0 4px 14px rgba(82,183,136,0.35)',
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
              background: 'white',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              padding: '20px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ color: '#64748b', fontSize: '13px', fontWeight: 500 }}>{card.label}</span>
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
            <div style={{ fontSize: '28px', fontWeight: 700, color: '#0f172a' }}>
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
            background: 'white',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid #f1f5f9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Recent Campaigns</h2>
            <button
              onClick={() => navigate('/campaigns')}
              style={{
                background: 'none',
                border: 'none',
                color: '#52b788',
                fontSize: '13px',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              View all →
            </button>
          </div>
          {campaignsLoading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
              Loading campaigns…
            </div>
          ) : campaigns.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>
              No campaigns yet.{' '}
              <span
                onClick={() => navigate('/create')}
                style={{ color: '#52b788', cursor: 'pointer', fontWeight: 500 }}
              >
                Create your first campaign →
              </span>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#fafbfc' }}>
                  {['Campaign', 'Platforms', 'Status', 'Posts', 'Created'].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '10px 16px',
                        textAlign: 'left',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#94a3b8',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        borderBottom: '1px solid #f1f5f9',
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
              background: 'white',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              padding: '20px',
            }}
          >
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', marginBottom: '16px' }}>
              Platform Performance
            </h3>
            {platformPerformance.length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: '13px', textAlign: 'center', padding: '16px 0' }}>
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
                        <span style={{ fontSize: '13px', fontWeight: 500, color: '#334155' }}>{cfg.name}</span>
                      </div>
                      <span style={{ fontSize: '12px', color: '#64748b' }}>
                        {engagements >= 1000 ? `${(engagements / 1000).toFixed(1)}k` : engagements} engagements
                      </span>
                    </div>
                    <div style={{ height: '6px', background: '#f1f5f9', borderRadius: '3px', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${pct}%`,
                          background: cfg.bgColor ?? '#6366f1',
                          borderRadius: '3px',
                          transition: 'width 0.8s ease',
                        }}
                      />
                    </div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '3px' }}>{posts} posts</div>
                  </div>
                )
              })
            )}
          </div>

          {/* Quick actions */}
          <div
            style={{
              background: 'white',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              padding: '20px',
            }}
          >
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', marginBottom: '14px' }}>
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
                  border: primary ? 'none' : '1px solid #e2e8f0',
                  background: primary ? 'linear-gradient(135deg, #52b788, #40916c)' : '#fafbfc',
                  color: primary ? 'white' : '#334155',
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
