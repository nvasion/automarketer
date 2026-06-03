import { PLATFORM_CONFIGS } from '../data/sampleData'
import PlatformBadge from '../components/PlatformBadge'
import type { Platform } from '../types'
import { useCampaigns } from '../hooks/useCampaigns'

function Analytics() {
  const { campaigns } = useCampaigns()

  const topPosts = campaigns.flatMap((c) =>
    c.posts
      .filter((p) => p.engagements)
      .map((p) => ({
        content: p.content.slice(0, 100) + '…',
        platform: p.platform,
        engagements: (p.engagements?.likes ?? 0) + (p.engagements?.comments ?? 0) + (p.engagements?.shares ?? 0),
        views: p.engagements?.views ?? 0,
        campaign: c.name,
      }))
  ).sort((a, b) => b.engagements - a.engagements)

  const totalEngagements = campaigns.reduce((sum, c) =>
    sum + c.posts.reduce((s, p) => {
      const e = p.engagements
      return s + (e ? e.likes + e.comments + e.shares : 0)
    }, 0), 0)

  const totalViews = campaigns.reduce((sum, c) =>
    sum + c.posts.reduce((s, p) => s + (p.engagements?.views ?? 0), 0), 0)

  const publishedCount = campaigns.reduce(
    (sum, c) => sum + c.posts.filter((p) => p.status === 'published').length, 0
  )

  const avgRate = totalViews > 0
    ? ((totalEngagements / totalViews) * 100).toFixed(1)
    : '0.0'

  const formatNum = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

  // Compute platform breakdown from real campaign data
  const platformStats = PLATFORM_CONFIGS.map((cfg) => {
    const posts = campaigns.flatMap((c) => c.posts).filter((p) => p.platform === cfg.id)
    const engagements = posts
      .filter((p) => p.engagements)
      .reduce((sum, p) => sum + (p.engagements?.likes ?? 0) + (p.engagements?.comments ?? 0) + (p.engagements?.shares ?? 0), 0)
    return { platform: cfg.id as Platform, posts: posts.length, engagements }
  }).filter((s) => s.posts > 0)

  return (
    <div style={{ padding: '32px' }}>
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
          Analytics
        </h1>
        <p style={{ color: '#64748b', fontSize: '14px' }}>
          Performance insights across all your campaigns and platforms.
        </p>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '28px' }}>
        {[
          { icon: '👁️', label: 'Total Reach', value: formatNum(totalViews), sub: 'Unique accounts reached' },
          { icon: '❤️', label: 'Engagements', value: formatNum(totalEngagements), sub: 'Likes, comments & shares' },
          { icon: '📈', label: 'Avg. Rate', value: `${avgRate}%`, sub: 'Engagement per impression' },
          { icon: '✅', label: 'Posts Published', value: String(publishedCount), sub: 'Across all platforms' },
        ].map(({ icon, label, value, sub }) => (
          <div
            key={label}
            style={{
              background: 'white',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              padding: '20px',
            }}
          >
            <div style={{ fontSize: '22px', marginBottom: '8px' }}>{icon}</div>
            <div style={{ fontSize: '26px', fontWeight: 700, color: '#0f172a', marginBottom: '2px' }}>{value}</div>
            <div style={{ fontWeight: 600, fontSize: '13px', color: '#475569', marginBottom: '2px' }}>{label}</div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Platform breakdown */}
      <div
        style={{
          background: 'white',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          padding: '24px',
          marginBottom: '24px',
        }}
      >
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', margin: '0 0 20px' }}>
          Platform Breakdown
        </h2>
        {platformStats.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>
            No platform data yet. Publish posts to see a breakdown.
          </div>
        ) : (
          platformStats.map(({ platform, posts, engagements }) => {
            const cfg = PLATFORM_CONFIGS.find((p) => p.id === platform)
            return (
              <div
                key={platform}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 0',
                  borderBottom: '1px solid #f1f5f9',
                }}
              >
                <PlatformBadge platform={platform} size="md" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>{cfg?.name}</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>{posts} posts</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#1e293b' }}>
                    {engagements >= 1000 ? `${(engagements / 1000).toFixed(1)}k` : engagements}
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>engagements</div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Top performing posts */}
      <div
        style={{
          background: 'white',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #f1f5f9',
            fontWeight: 700,
            fontSize: '15px',
            color: '#0f172a',
          }}
        >
          Top Performing Posts
        </div>
        {topPosts.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>
            No published posts with engagement data yet.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#fafbfc' }}>
                {['Post', 'Platform', 'Campaign', 'Engagements', 'Views'].map((h) => (
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
              {topPosts.map((post, i) => (
                <tr key={i}>
                  <td style={{ padding: '12px 16px', borderBottom: '1px solid #f8f9fa', maxWidth: '320px' }}>
                    <p style={{ fontSize: '13px', color: '#334155', margin: 0, lineHeight: 1.4 }}>{post.content}</p>
                  </td>
                  <td style={{ padding: '12px 16px', borderBottom: '1px solid #f8f9fa' }}>
                    <PlatformBadge platform={post.platform as Platform} size="sm" showLabel />
                  </td>
                  <td style={{ padding: '12px 16px', borderBottom: '1px solid #f8f9fa', fontSize: '13px', color: '#64748b' }}>
                    {post.campaign}
                  </td>
                  <td style={{ padding: '12px 16px', borderBottom: '1px solid #f8f9fa' }}>
                    <span style={{ fontWeight: 700, fontSize: '14px', color: '#1e293b' }}>
                      {post.engagements >= 1000 ? `${(post.engagements / 1000).toFixed(1)}k` : post.engagements}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', borderBottom: '1px solid #f8f9fa', fontSize: '13px', color: '#64748b' }}>
                    {post.views >= 1000 ? `${(post.views / 1000).toFixed(1)}k` : post.views}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default Analytics
