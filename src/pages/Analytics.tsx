import { PLATFORM_CONFIGS } from '../data/sampleData'
import PlatformBadge from '../components/PlatformBadge'
import type { Platform } from '../types'
import { useCampaigns } from '../hooks/useCampaigns'

// ─── Date helpers ──────────────────────────────────────────────────────────

/** Monday-aligned start of the week containing `d`, at 00:00 local time. */
function startOfWeek(d: Date): Date {
  const x = new Date(d)
  const day = x.getDay() // 0 = Sunday
  const diffToMonday = (day + 6) % 7
  x.setDate(x.getDate() - diffToMonday)
  x.setHours(0, 0, 0, 0)
  return x
}

const NUM_WEEKS = 8

function Analytics() {
  const { campaigns } = useCampaigns()

  // Flatten every post once, carrying its campaign name for display.
  const allPosts = campaigns.flatMap((c) => c.posts.map((p) => ({ ...p, campaign: c.name })))

  const publishedPosts = allPosts.filter((p) => p.status === 'published')
  const publishedCount = publishedPosts.length
  const scheduledCount = allPosts.filter((p) => p.status === 'scheduled').length
  const draftCount = allPosts.filter((p) => p.status === 'draft').length

  // ── Publishing activity over the last 8 weeks (from publishedAt) ──────────
  const thisWeekStart = startOfWeek(new Date())
  const weeks = Array.from({ length: NUM_WEEKS }, (_, i) => {
    const start = new Date(thisWeekStart)
    start.setDate(start.getDate() - (NUM_WEEKS - 1 - i) * 7)
    const end = new Date(start)
    end.setDate(end.getDate() + 7)
    const count = publishedPosts.filter((p) => {
      if (!p.publishedAt) return false
      const t = new Date(p.publishedAt).getTime()
      return t >= start.getTime() && t < end.getTime()
    }).length
    return { label: `${start.getMonth() + 1}/${start.getDate()}`, count }
  })
  const maxWeek = Math.max(...weeks.map((w) => w.count), 1)

  // ── Per-platform breakdown (total + published counts) ─────────────────────
  const platformStats = PLATFORM_CONFIGS.map((cfg) => {
    const posts = allPosts.filter((p) => p.platform === cfg.id)
    const published = posts.filter((p) => p.status === 'published').length
    return { platform: cfg.id as Platform, cfg, total: posts.length, published }
  }).filter((s) => s.total > 0)

  // ── Recently published posts ──────────────────────────────────────────────
  const recentPublished = [...publishedPosts]
    .filter((p) => p.publishedAt)
    .sort((a, b) => new Date(b.publishedAt!).getTime() - new Date(a.publishedAt!).getTime())
    .slice(0, 10)

  const summaryCards = [
    { icon: '📣', label: 'Posts Published', value: String(publishedCount), sub: 'Across all platforms' },
    { icon: '🗓️', label: 'Scheduled', value: String(scheduledCount), sub: 'Queued to publish' },
    { icon: '✏️', label: 'Drafts', value: String(draftCount), sub: 'Not yet scheduled' },
    { icon: '📦', label: 'Campaigns', value: String(campaigns.length), sub: 'Total campaigns' },
  ]

  return (
    <div style={{ padding: '32px' }}>
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '30px', fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>
          Analytics
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '14px' }}>
          Publishing activity across all your campaigns and platforms.
        </p>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '20px' }}>
        {summaryCards.map(({ icon, label, value, sub }) => (
          <div
            key={label}
            style={{
              background: 'var(--panel)',
              borderRadius: '12px',
              border: '1px solid var(--line)',
              padding: '20px',
            }}
          >
            <div style={{ fontSize: '22px', marginBottom: '8px' }}>{icon}</div>
            <div style={{ fontSize: '26px', fontWeight: 700, color: 'var(--ink)', marginBottom: '2px' }}>{value}</div>
            <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--ink-2)', marginBottom: '2px' }}>{label}</div>
            <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Engagement-metrics notice */}
      <div
        style={{
          background: 'var(--sunken)',
          border: '1px solid var(--line)',
          borderRadius: '10px',
          padding: '12px 16px',
          marginBottom: '28px',
          fontSize: '12px',
          color: 'var(--muted)',
        }}
      >
        💡 Engagement metrics (likes, comments, views) will appear here once a platform's metrics API is
        connected. Until then, Analytics reflects your real publishing activity.
      </div>

      {/* Publishing activity chart */}
      <div
        style={{
          background: 'var(--panel)',
          borderRadius: '16px',
          border: '1px solid var(--line)',
          padding: '24px',
          marginBottom: '24px',
        }}
      >
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--ink)', margin: '0 0 20px' }}>
          Publishing Activity (last {NUM_WEEKS} weeks)
        </h2>
        {publishedCount === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--muted)', fontSize: '14px' }}>
            No posts published yet. Publish a post to see your activity here.
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: '12px',
              height: '160px',
              paddingTop: '8px',
            }}
          >
            {weeks.map((w) => (
              <div
                key={w.label}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%' }}
              >
                <div
                  style={{ flex: 1, display: 'flex', alignItems: 'flex-end', width: '100%', justifyContent: 'center' }}
                >
                  <div
                    data-testid={`week-bar-${w.label}`}
                    title={`${w.count} post${w.count === 1 ? '' : 's'}`}
                    style={{
                      width: '60%',
                      height: `${(w.count / maxWeek) * 100}%`,
                      minHeight: w.count > 0 ? '4px' : '0',
                      background: 'var(--primary)',
                      borderRadius: '6px 6px 0 0',
                      transition: 'height 0.3s',
                    }}
                  />
                </div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-2)', marginTop: '6px' }}>{w.count}</div>
                <div style={{ fontSize: '10px', color: 'var(--muted)' }}>{w.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Platform breakdown */}
      <div
        style={{
          background: 'var(--panel)',
          borderRadius: '16px',
          border: '1px solid var(--line)',
          padding: '24px',
          marginBottom: '24px',
        }}
      >
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--ink)', margin: '0 0 20px' }}>
          Platform Breakdown
        </h2>
        {platformStats.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--muted)', fontSize: '14px' }}>
            No posts yet. Create a campaign to see a breakdown.
          </div>
        ) : (
          platformStats.map(({ platform, cfg, total, published }) => (
            <div
              key={platform}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 0',
                borderBottom: '1px solid var(--line-soft)',
              }}
            >
              <PlatformBadge platform={platform} size="md" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--ink)' }}>{cfg.name}</div>
                <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{total} post{total === 1 ? '' : 's'}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--ink)' }}>{published}</div>
                <div style={{ fontSize: '11px', color: 'var(--muted)' }}>published</div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Recently published posts */}
      <div
        style={{
          background: 'var(--panel)',
          borderRadius: '16px',
          border: '1px solid var(--line)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid var(--line-soft)',
            fontWeight: 700,
            fontSize: '15px',
            color: 'var(--ink)',
          }}
        >
          Recently Published
        </div>
        {recentPublished.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)', fontSize: '14px' }}>
            No published posts yet.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--sunken)' }}>
                {['Post', 'Platform', 'Campaign', 'Published'].map((h) => (
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
              {recentPublished.map((post) => (
                <tr key={post.id}>
                  <td style={{ padding: '12px 16px', borderBottom: '1px solid var(--line-soft)', maxWidth: '320px' }}>
                    <p style={{ fontSize: '13px', color: 'var(--ink-2)', margin: 0, lineHeight: 1.4 }}>
                      {post.content.length > 100 ? `${post.content.slice(0, 100)}…` : post.content}
                    </p>
                  </td>
                  <td style={{ padding: '12px 16px', borderBottom: '1px solid var(--line-soft)' }}>
                    <PlatformBadge platform={post.platform} size="sm" showLabel />
                  </td>
                  <td style={{ padding: '12px 16px', borderBottom: '1px solid var(--line-soft)', fontSize: '13px', color: 'var(--muted)' }}>
                    {post.campaign}
                  </td>
                  <td style={{ padding: '12px 16px', borderBottom: '1px solid var(--line-soft)', fontSize: '13px', color: 'var(--muted)' }}>
                    {new Date(post.publishedAt!).toLocaleDateString()}
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
