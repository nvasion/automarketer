import { SAMPLE_CAMPAIGNS, PLATFORM_CONFIGS } from '../data/sampleData'
import PlatformBadge from '../components/PlatformBadge'
import { Platform } from '../types'

const WEEKLY_DATA = [
  { day: 'Mon', linkedin: 120, twitter: 340, reddit: 45 },
  { day: 'Tue', linkedin: 200, twitter: 520, reddit: 90 },
  { day: 'Wed', linkedin: 180, twitter: 480, reddit: 120 },
  { day: 'Thu', linkedin: 310, twitter: 890, reddit: 68 },
  { day: 'Fri', linkedin: 280, twitter: 720, reddit: 203 },
  { day: 'Sat', linkedin: 90, twitter: 310, reddit: 55 },
  { day: 'Sun', linkedin: 60, twitter: 220, reddit: 30 },
]

const maxTotal = Math.max(...WEEKLY_DATA.map((d) => d.linkedin + d.twitter + d.reddit))

const PLATFORM_STATS: { platform: Platform; posts: number; engagements: number; reach: number; growth: string }[] = [
  { platform: 'twitter', posts: 18, engagements: 18400, reach: 94000, growth: '+24%' },
  { platform: 'linkedin', posts: 15, engagements: 8200, reach: 41000, growth: '+18%' },
  { platform: 'reddit', posts: 8, engagements: 3100, reach: 28000, growth: '+31%' },
  { platform: 'instagram', posts: 6, engagements: 2100, reach: 18000, growth: '+12%' },
]

const TOP_POSTS = SAMPLE_CAMPAIGNS.flatMap((c) =>
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

function Analytics() {
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
          { icon: '👁️', label: 'Total Reach', value: '181K', sub: 'Unique accounts reached' },
          { icon: '❤️', label: 'Engagements', value: '31.8K', sub: 'Likes, comments & shares' },
          { icon: '📈', label: 'Avg. Rate', value: '4.2%', sub: 'Engagement per impression' },
          { icon: '✅', label: 'Posts Published', value: '47', sub: 'Across all platforms' },
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '24px', marginBottom: '24px' }}>
        {/* Weekly chart */}
        <div
          style={{
            background: 'white',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            padding: '24px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Weekly Engagement</h2>
            <div style={{ display: 'flex', gap: '12px' }}>
              {[
                { color: '#0077B5', label: 'LinkedIn' },
                { color: '#000000', label: 'X/Twitter' },
                { color: '#FF4500', label: 'Reddit' },
              ].map(({ color, label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: color }} />
                  <span style={{ fontSize: '11px', color: '#64748b' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bar chart */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', height: '180px' }}>
            {WEEKLY_DATA.map((d) => {
              const scale = (val: number) => `${(val / maxTotal) * 100}%`
              return (
                <div key={d.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%' }}>
                  <div
                    style={{
                      flex: 1,
                      width: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'flex-end',
                    }}
                  >
                    <div title={`Reddit: ${d.reddit}`}
                      style={{ background: '#FF4500', height: scale(d.reddit), borderRadius: '2px 2px 0 0', opacity: 0.9 }} />
                    <div title={`Twitter: ${d.twitter}`}
                      style={{ background: '#000000', height: scale(d.twitter), opacity: 0.85 }} />
                    <div title={`LinkedIn: ${d.linkedin}`}
                      style={{ background: '#0077B5', height: scale(d.linkedin), borderRadius: '0 0 4px 4px', opacity: 0.9 }} />
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>{d.day}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Platform breakdown */}
        <div
          style={{
            background: 'white',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            padding: '24px',
          }}
        >
          <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', marginBottom: '20px' }}>
            Platform Breakdown
          </h2>
          {PLATFORM_STATS.map(({ platform, posts, engagements, reach, growth }) => {
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
                  <div style={{ fontSize: '11px', color: '#16a34a', fontWeight: 500 }}>{growth}</div>
                </div>
              </div>
            )
          })}
        </div>
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
            {TOP_POSTS.map((post, i) => (
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
      </div>
    </div>
  )
}

export default Analytics
