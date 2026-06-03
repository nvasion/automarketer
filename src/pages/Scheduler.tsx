import { useMemo, useState } from 'react'
import PlatformBadge from '../components/PlatformBadge'
import StatusBadge from '../components/StatusBadge'
import { useCampaigns } from '../hooks/useCampaigns'
import type { PostRecord, CampaignRecord } from '../db/schema'
import type { Platform } from '../types'

interface ScheduledItem {
  post: PostRecord
  campaignName: string
  campaignId: string
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function buildScheduledItems(campaigns: CampaignRecord[]): ScheduledItem[] {
  return campaigns.flatMap((c) =>
    c.posts
      .filter((p) => p.status === 'scheduled' || p.status === 'published')
      .map((p) => ({ post: p, campaignName: c.name, campaignId: c.id }))
  )
}

function getPostsForDay(
  items: ScheduledItem[],
  year: number,
  month: number,
  day: number
): ScheduledItem[] {
  return items.filter((item) => {
    const dateStr = item.post.scheduledAt ?? item.post.publishedAt
    if (!dateStr) return false
    const d = new Date(dateStr)
    return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day
  })
}

function Scheduler() {
  const today = useMemo(() => new Date(), [])
  const [viewYear, setViewYear] = useState(() => today.getFullYear())
  const [viewMonth, setViewMonth] = useState(() => today.getMonth())
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const { campaigns } = useCampaigns()

  const allScheduled = buildScheduledItems(campaigns)

  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1) }
    else setViewMonth((m) => m - 1)
    setSelectedDay(null)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1) }
    else setViewMonth((m) => m + 1)
    setSelectedDay(null)
  }

  const selectedItems = selectedDay
    ? getPostsForDay(allScheduled, viewYear, viewMonth, selectedDay)
    : []

  const upcomingPosts = allScheduled
    .filter((item) => item.post.status === 'scheduled')
    .sort((a, b) => {
      const da = new Date(a.post.scheduledAt ?? 0).getTime()
      const db = new Date(b.post.scheduledAt ?? 0).getTime()
      return da - db
    })

  return (
    <div style={{ padding: '32px' }}>
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
          Scheduler
        </h1>
        <p style={{ color: '#64748b', fontSize: '14px' }}>
          Plan and schedule your social media posts across all platforms.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '24px' }}>
        {/* Calendar */}
        <div
          style={{
            background: 'white',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            overflow: 'hidden',
          }}
        >
          {/* Month navigation */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '18px 20px',
              borderBottom: '1px solid #f1f5f9',
            }}
          >
            <button
              onClick={prevMonth}
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                width: '32px',
                height: '32px',
                cursor: 'pointer',
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ‹
            </button>
            <h2 style={{ fontWeight: 700, color: '#0f172a', fontSize: '16px' }}>
              {MONTHS[viewMonth]} {viewYear}
            </h2>
            <button
              onClick={nextMonth}
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                width: '32px',
                height: '32px',
                cursor: 'pointer',
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ›
            </button>
          </div>

          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '0 8px' }}>
            {DAYS.map((d) => (
              <div
                key={d}
                style={{
                  textAlign: 'center',
                  padding: '10px 4px',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#94a3b8',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {d}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: '2px',
              padding: '0 8px 12px',
            }}
          >
            {/* Empty cells before first day */}
            {Array.from({ length: firstDay }, (_, i) => (
              <div key={`empty-${i}`} />
            ))}

            {/* Day cells */}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1
              const isToday =
                viewYear === today.getFullYear() &&
                viewMonth === today.getMonth() &&
                day === today.getDate()
              const isSelected = selectedDay === day
              const dayPosts = getPostsForDay(allScheduled, viewYear, viewMonth, day)

              return (
                <div
                  key={day}
                  onClick={() => setSelectedDay(selectedDay === day ? null : day)}
                  style={{
                    borderRadius: '8px',
                    padding: '6px',
                    cursor: 'pointer',
                    background: isSelected ? '#d8f3dc' : 'transparent',
                    border: `1px solid ${isSelected ? '#b7e4c7' : 'transparent'}`,
                    transition: 'all 0.1s',
                    minHeight: '62px',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = '#f8fafc'
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'transparent'
                  }}
                >
                  <div
                    style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '50%',
                      background: isToday ? '#52b788' : 'transparent',
                      color: isToday ? 'white' : '#334155',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '13px',
                      fontWeight: isToday ? 700 : 400,
                      marginBottom: '4px',
                    }}
                  >
                    {day}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
                    {dayPosts.slice(0, 3).map((item) => (
                      <div
                        key={item.post.id}
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '2px',
                          background:
                            item.post.status === 'published' ? '#22c55e' : '#f59e0b',
                        }}
                        title={`${item.campaignName} — ${item.post.platform}`}
                      />
                    ))}
                    {dayPosts.length > 3 && (
                      <span style={{ fontSize: '9px', color: '#94a3b8' }}>+{dayPosts.length - 3}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Selected day detail */}
          {selectedDay !== null && (
            <div
              style={{
                borderTop: '1px solid #f1f5f9',
                padding: '16px 20px',
                background: '#fafbfc',
              }}
            >
              <h3 style={{ fontWeight: 600, fontSize: '14px', color: '#1e293b', marginBottom: '12px' }}>
                {MONTHS[viewMonth]} {selectedDay}, {viewYear}
              </h3>
              {selectedItems.length === 0 ? (
                <p style={{ color: '#94a3b8', fontSize: '13px' }}>No posts scheduled for this day.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {selectedItems.map((item) => (
                    <div
                      key={item.post.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        background: 'white',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        padding: '10px 12px',
                      }}
                    >
                      <PlatformBadge platform={item.post.platform} size="sm" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: '13px', color: '#1e293b' }}>
                          {item.campaignName}
                        </div>
                        <div
                          style={{
                            fontSize: '12px',
                            color: '#94a3b8',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {item.post.content.slice(0, 60)}…
                        </div>
                      </div>
                      <StatusBadge status={item.post.status} size="sm" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Upcoming posts */}
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
                padding: '16px 20px',
                borderBottom: '1px solid #f1f5f9',
                fontWeight: 700,
                fontSize: '15px',
                color: '#0f172a',
              }}
            >
              Upcoming Posts
            </div>
            <div style={{ padding: '12px' }}>
              {upcomingPosts.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                  No upcoming posts scheduled.
                </div>
              ) : (
                upcomingPosts.map((item) => {
                  const date = new Date(item.post.scheduledAt ?? '')
                  return (
                    <div
                      key={item.post.id}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '10px',
                        padding: '10px',
                        borderRadius: '8px',
                        marginBottom: '4px',
                      }}
                    >
                      <PlatformBadge platform={item.post.platform as Platform} size="sm" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: '13px', color: '#1e293b', marginBottom: '2px' }}>
                          {item.campaignName}
                        </div>
                        <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                          📅{' '}
                          {date.toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Legend */}
          <div
            style={{
              background: 'white',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              padding: '16px 20px',
            }}
          >
            <h3 style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b', marginBottom: '12px' }}>
              Legend
            </h3>
            {[
              { color: '#22c55e', label: 'Published' },
              { color: '#f59e0b', label: 'Scheduled' },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: color }} />
                <span style={{ fontSize: '13px', color: '#64748b' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default Scheduler
