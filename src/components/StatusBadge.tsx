import { CampaignStatus, PostStatus } from '../types'

type Status = CampaignStatus | PostStatus

const STATUS_CONFIG: Record<Status, { label: string; bg: string; color: string; dot: string }> = {
  draft: { label: 'Draft', bg: 'var(--chip)', color: 'var(--muted)', dot: 'var(--muted)' },
  // Activity is ember on TynHub (--live), never the interactive azure.
  generating: { label: 'Generating…', bg: 'var(--chip)', color: 'var(--live)', dot: 'var(--live)' },
  ready: { label: 'Ready', bg: 'var(--ok-soft)', color: 'var(--ok)', dot: 'var(--ok)' },
  published: { label: 'Published', bg: 'var(--ok-soft)', color: 'var(--ok)', dot: 'var(--ok)' },
  scheduled: { label: 'Scheduled', bg: 'var(--warn-soft)', color: 'var(--warn)', dot: 'var(--warn)' },
  failed: { label: 'Failed', bg: 'var(--fail-soft)', color: 'var(--fail)', dot: 'var(--fail)' },
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
