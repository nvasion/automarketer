import { Platform } from '../types'
import { PLATFORM_CONFIGS } from '../data/sampleData'

interface Props {
  platform: Platform
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
}

function PlatformBadge({ platform, size = 'md', showLabel = false }: Props) {
  const config = PLATFORM_CONFIGS.find((p) => p.id === platform)
  if (!config) return null

  const sizes = {
    sm: { w: 22, h: 22, font: 9 },
    md: { w: 28, h: 28, font: 11 },
    lg: { w: 36, h: 36, font: 14 },
  }
  const s = sizes[size]

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
      }}
    >
      <span
        style={{
          width: s.w,
          height: s.h,
          borderRadius: '6px',
          backgroundColor: config.bgColor,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: config.color,
          fontSize: s.font,
          fontWeight: 700,
          flexShrink: 0,
          letterSpacing: '-0.5px',
        }}
      >
        {config.icon}
      </span>
      {showLabel && (
        <span style={{ fontSize: '13px', fontWeight: 500, color: '#1e293b' }}>{config.name}</span>
      )}
    </span>
  )
}

export default PlatformBadge
