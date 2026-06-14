import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { PLATFORM_CONFIGS } from '../data/sampleData'
import type { PostRecord } from '../db/schema'
import type { Platform } from '../types'
import { useCampaign } from '../hooks/useCampaign'
import { useAuth } from '../contexts/AuthContext'
import PlatformBadge from '../components/PlatformBadge'
import StatusBadge from '../components/StatusBadge'
import PostCard from '../components/PostCard'
import { publishService, PublishError } from '../services/publishService'
import { fetchPlatformClientIds } from '../services/platformConfigService'
import type { PlatformClientIds } from '../services/platformConfigService'

function CampaignDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { campaign, loading, error, update } = useCampaign(id)
  const [posts, setPosts] = useState<PostRecord[] | null>(null)
  const [activeTab, setActiveTab] = useState<Platform | 'all'>('all')
  const [publishing, setPublishing] = useState<Record<string, boolean>>({})
  const [publishError, setPublishError] = useState<Record<string, string>>({})
  const [platformConnections, setPlatformConnections] = useState<PlatformClientIds | null>(null)

  // Load the server's configured platforms so publish/republish buttons can be
  // greyed out for platforms that aren't set up (no OAuth app configured).
  // A non-empty client ID means the platform is available to publish to; the
  // per-user access-token check still happens server-side at publish time.
  useEffect(() => {
    let cancelled = false
    fetchPlatformClientIds()
      .then((ids) => {
        if (!cancelled) setPlatformConnections(ids)
      })
      .catch((err) => {
        console.warn('[CampaignDetail] Failed to load platform connections:', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Use local post state if updated, otherwise use posts from the loaded campaign
  const activePosts = posts ?? campaign?.posts ?? []

  // While connection state is still loading (null) the buttons stay enabled —
  // the publish-time connection check below remains the safety net.
  const isPlatformConnected = (platform: Platform): boolean =>
    platformConnections === null || Boolean(platformConnections[platform])

  if (loading) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>
        <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
        <p>Loading campaign…</p>
      </div>
    )
  }

  if (error || !campaign) {
    return (
      <div style={{ padding: '32px', textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>😕</div>
        <h2 style={{ color: '#1e293b', marginBottom: '8px' }}>Campaign not found</h2>
        <button
          onClick={() => navigate('/campaigns')}
          style={{
            background: '#52b788',
            border: 'none',
            borderRadius: '8px',
            padding: '10px 24px',
            color: 'white',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          ← Back to Campaigns
        </button>
      </div>
    )
  }

  /**
   * Publish (or republish) a post to its platform API and persist the
   * resulting status/timestamp. Shared by "Publish Now" and "Republish".
   */
  const publishPost = async (post: PostRecord) => {
    setPublishing((prev) => ({ ...prev, [post.id]: true }))
    setPublishError((prev) => ({ ...prev, [post.id]: '' }))

    console.info(`[CampaignDetail] Publishing post ${post.id} to ${post.platform}…`)

    try {
      // Get the user's platform client IDs to check if connected
      const clientIds = await fetchPlatformClientIds()
      if (!clientIds[post.platform] || clientIds[post.platform] === '') {
        console.error(
          `[CampaignDetail] ${post.platform} has no client ID configured — aborting publish. ` +
            'Connect the platform in Settings → Connected Platforms.'
        )
        throw new Error(
          `${post.platform.charAt(0).toUpperCase() + post.platform.slice(1)} is not connected. Please connect your account in Settings.`
        )
      }

      // Build platform-specific options
      let platformOptions: Record<string, unknown> | undefined

      if (post.platform === 'linkedin') {
        // The member URN is stored in localStorage by the connection modal
        // when the OAuth flow completes (the server resolves it from
        // LinkedIn's userinfo endpoint and returns it as `authorId`).
        const authorIdKey = `linkedin_authorId_${user?.id ?? 'default'}`
        const authorId = localStorage.getItem(authorIdKey)
        if (!authorId) {
          console.error(
            `[CampaignDetail] No LinkedIn author ID in localStorage (key=${authorIdKey}). ` +
              'It is stored during the OAuth connect flow — disconnect and reconnect LinkedIn in Settings. ' +
              'If reconnecting does not help, check the server [oauth] logs for the userinfo failure reason.'
          )
          throw new Error(
            'LinkedIn author ID not found. Disconnect and reconnect your LinkedIn account in Settings to refresh it.'
          )
        }
        console.info('[CampaignDetail] LinkedIn author ID found — publishing as', authorId)
        platformOptions = { authorId }
      }

      if (post.platform === 'reddit') {
        // Reddit submissions need target subreddit(s) and a title; both come
        // from the campaign (the campaign name doubles as the post title).
        const subreddits = campaign?.subreddits ?? []
        if (subreddits.length === 0) {
          throw new Error(
            'No subreddits configured for this campaign. Add at least one subreddit via Edit Campaign.'
          )
        }
        platformOptions = { subreddit: subreddits, title: campaign?.name ?? '' }
      }

      // Call the publish API
      const result = await publishService.publish(
        post.platform,
        post.content,
        post.hashtags ?? [],
        platformOptions,
      )

      // Update the post with published status and timestamp
      const updatedPosts = activePosts.map((p) =>
        p.id === post.id
          ? {
              ...p,
              status: 'published' as const,
              publishedAt: new Date().toISOString(),
            }
          : p,
      )
      setPosts(updatedPosts)
      await update({ posts: updatedPosts }).catch(() => {
        setPosts(activePosts)
      })

      console.info('[CampaignDetail] Published successfully:', result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to publish'
      setPublishError((prev) => ({ ...prev, [post.id]: message }))
      if (err instanceof PublishError) {
        console.error(
          `[CampaignDetail] Publish failed for post ${post.id} (${post.platform}): ` +
            `HTTP ${err.httpStatus ?? '?'} code=${err.code ?? 'unknown'} — ${err.message}. ` +
            'The server [publish] logs have the full platform response.'
        )
      } else {
        console.error(`[CampaignDetail] Publish failed for post ${post.id} (${post.platform}):`, err)
      }
      // Don't revert - let the user retry
    } finally {
      setPublishing((prev) => ({ ...prev, [post.id]: false }))
    }
  }

  const handleStatusChange = async (postId: string, status: PostRecord['status']) => {
    const post = activePosts.find((p) => p.id === postId)
    if (!post) return

    // If changing to 'published', actually publish to the platform API
    if (status === 'published' && post.status !== 'published') {
      await publishPost(post)
    } else {
      // For other status changes, just update locally
      const updatedPosts = activePosts.map((p) => (p.id === postId ? { ...p, status } : p))
      setPosts(updatedPosts)
      await update({ posts: updatedPosts }).catch(() => {
        setPosts(activePosts)
      })
    }
  }

  /** Re-run the platform publish for a post that is already published. */
  const handleRepublish = async (postId: string) => {
    const post = activePosts.find((p) => p.id === postId)
    if (!post || post.status !== 'published') return
    await publishPost(post)
  }

  const filteredPosts =
    activeTab === 'all' ? activePosts : activePosts.filter((p) => p.platform === activeTab)

  const totalEngagements = activePosts.reduce((sum, p) => {
    const e = p.engagements
    return sum + (e ? e.likes + e.comments + e.shares : 0)
  }, 0)

  const publishedCount = activePosts.filter((p) => p.status === 'published').length

  return (
    <div style={{ padding: '32px' }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
        <button
          onClick={() => navigate('/campaigns')}
          style={{
            background: 'none',
            border: 'none',
            color: '#52b788',
            fontSize: '13px',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          Campaigns
        </button>
        <span style={{ color: '#cbd5e1' }}>›</span>
        <span style={{ color: '#64748b', fontSize: '13px' }}>{campaign.name}</span>
      </div>

      {/* Campaign header */}
      <div
        style={{
          background: 'white',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          padding: '24px',
          marginBottom: '24px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>{campaign.name}</h1>
              <StatusBadge status={campaign.status} pulse={campaign.status === 'generating'} />
            </div>
            <a
              href={campaign.websiteUrl}
              style={{ color: '#52b788', fontSize: '14px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              🌐 {campaign.websiteUrl}
            </a>
            <p style={{ color: '#64748b', fontSize: '14px', marginTop: '8px', lineHeight: 1.6 }}>
              {campaign.description}
            </p>
            <div style={{ display: 'flex', gap: '16px', marginTop: '12px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '13px', color: '#64748b' }}>
                👥 <strong>Audience:</strong> {campaign.targetAudience}
              </span>
              <span style={{ fontSize: '13px', color: '#64748b' }}>
                🎯 <strong>Tone:</strong> {campaign.tone.charAt(0).toUpperCase() + campaign.tone.slice(1)}
              </span>
              <span style={{ fontSize: '13px', color: '#64748b' }}>
                📅 <strong>Created:</strong>{' '}
                {new Date(campaign.createdAt).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            {campaign.status === 'ready' && (
              <button
                style={{
                  background: 'linear-gradient(135deg, #52b788, #40916c)',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '9px 18px',
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(82,183,136,0.35)',
                }}
              >
                🚀 Publish All
              </button>
            )}
            <button
              onClick={() => navigate(`/campaigns/${campaign.id}/edit`)}
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '9px 18px',
                fontSize: '13px',
                color: '#64748b',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Edit Campaign
            </button>
          </div>
        </div>

        {/* Platforms */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #f1f5f9' }}>
          {campaign.platforms.map((p) => {
            const cfg = PLATFORM_CONFIGS.find((c) => c.id === p)
            return (
              <div
                key={p}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '5px 10px',
                }}
              >
                <PlatformBadge platform={p} size="sm" />
                <span style={{ fontSize: '12px', fontWeight: 500, color: '#475569' }}>{cfg?.name}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Stats row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '14px',
          marginBottom: '24px',
        }}
      >
        {[
          { icon: '📝', label: 'Total Posts', value: activePosts.length },
          { icon: '✅', label: 'Published', value: publishedCount },
          { icon: '📅', label: 'Scheduled', value: activePosts.filter((p) => p.status === 'scheduled').length },
          {
            icon: '❤️',
            label: 'Total Engagements',
            value: totalEngagements > 0 ? (totalEngagements >= 1000 ? `${(totalEngagements / 1000).toFixed(1)}k` : totalEngagements) : '—',
          },
        ].map(({ icon, label, value }) => (
          <div
            key={label}
            style={{
              background: 'white',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              padding: '16px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '20px', marginBottom: '4px' }}>{icon}</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>{value}</div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Posts section */}
      <div
        style={{
          background: 'white',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
        }}
      >
        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            gap: '0',
            borderBottom: '1px solid #f1f5f9',
            padding: '0 20px',
            overflowX: 'auto',
          }}
        >
          <button
            onClick={() => setActiveTab('all')}
            style={{
              background: 'none',
              border: 'none',
              padding: '14px 16px',
              fontSize: '13px',
              fontWeight: activeTab === 'all' ? 600 : 400,
              color: activeTab === 'all' ? '#40916c' : '#64748b',
              cursor: 'pointer',
              borderBottom: activeTab === 'all' ? '2px solid #52b788' : '2px solid transparent',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            All Posts ({activePosts.length})
          </button>
          {campaign.platforms.map((p) => {
            const cfg = PLATFORM_CONFIGS.find((c) => c.id === p)
            const count = activePosts.filter((post) => post.platform === p).length
            return (
              <button
                key={p}
                onClick={() => setActiveTab(p)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '14px 16px',
                  fontSize: '13px',
                  fontWeight: activeTab === p ? 600 : 400,
                  color: activeTab === p ? '#40916c' : '#64748b',
                  cursor: 'pointer',
                  borderBottom: activeTab === p ? '2px solid #52b788' : '2px solid transparent',
                  transition: 'all 0.15s',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <PlatformBadge platform={p} size="sm" />
                {cfg?.name} ({count})
              </button>
            )
          })}
        </div>

        {/* Posts list */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {filteredPosts.length > 0 ? (
            filteredPosts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onStatusChange={handleStatusChange}
                onRepublish={handleRepublish}
                publishing={publishing[post.id]}
                publishError={publishError[post.id]}
                platformConnected={isPlatformConnected(post.platform)}
              />
            ))
          ) : (
            <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>📭</div>
              <p>No posts for this platform yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default CampaignDetail
