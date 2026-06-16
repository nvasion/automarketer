/**
 * DemoBadge — a small inline pill to label prefilled demo/sample data.
 * Rendered next to any section or value that contains hardcoded placeholder content.
 */

interface DemoBadgeProps {
  /** Use "sm" for tight spaces (sidebar, inline text). Defaults to normal size. */
  size?: 'sm' | 'md'
}

function DemoBadge({ size = 'md' }: DemoBadgeProps) {
  const isSm = size === 'sm'
  return (
    <span
      title="This data is prefilled for demonstration purposes"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        background: '#fef3c7',
        color: '#92400e',
        border: '1px solid #fde68a',
        borderRadius: '4px',
        fontSize: isSm ? '9px' : '10px',
        fontWeight: 700,
        padding: isSm ? '1px 4px' : '1px 6px',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        lineHeight: 1.4,
        flexShrink: 0,
      }}
    >
      Demo
    </span>
  )
}

export default DemoBadge
