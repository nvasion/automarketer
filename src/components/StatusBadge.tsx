import { CampaignStatus, PostStatus } from '../types'

type Status = CampaignStatus | PostStatus

const STATUS_CONFIG: Record<Status, { label: string; bg: string; color: string; dot: string }> = {
  draft: { label: 'Draft', bg: '#f1f5f9', color: '#64748b', dot: '#94a3b8' },
  generating: { label: 'Generating…', bg: '#eff6ff', color: '#3b82f6', dot: '#3b82f6' },
  ready: { label: 'Ready', bg: '#f0fdf4', color: '#16a34a', dot: '#22c55e' },
  published: { label: 'Published', bg: '#f0fdf4', color: '#15803d', dot: '#22c55e' },
  scheduled: { label: 'Scheduled', bg: '#fefce8', color: '#a16207', dot: '#eab308' },
  failed: { label: 'Failed', bg: '#fef2f2', color: '#dc2626', dot: '#ef4444' },
}

interface Props {
  status: Status
  size?: 'sm' | 'md'
  pulse?: boolean
}

function StatusBadge({ status, size = 'md', pulse = false }: Props) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG['draft']
  const fontSize = size === 'sm' ? '11px' : '12px'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: size === 'sm' ? '2px 7px' : '3px 9px',
        borderRadius: '999px',
        backgroundColor: cfg.bg,
        color: cfg.color,
        fontSize,
        fontWeight: 600,
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          backgroundColor: cfg.dot,
          flexShrink: 0,
          animation: pulse && status === 'generating' ? 'pulse 1.5s infinite' : 'none',
        }}
      />
      {cfg.label}
    </span>
  )
}

export default StatusBadge
