interface AgentWarningBadgeProps {
  size?: 'sm' | 'md'
}

/**
 * Displays a warning indicator for platforms using agent-based authentication.
 * Shows a warning icon, text indicating higher token usage, and a tooltip
 * explaining why agent auth uses more tokens.
 */
function AgentWarningBadge({ size = 'md' }: AgentWarningBadgeProps) {
  const fontSize = size === 'sm' ? '10px' : '12px'
  const padding = size === 'sm' ? '2px 6px' : '3px 8px'

  return (
    <span
      title="Agent-based authentication uses API calls to post on your behalf, which consumes more tokens than direct platform authentication."
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding,
        borderRadius: '999px',
        backgroundColor: '#fef3c7',
        color: '#92400e',
        fontSize,
        fontWeight: 600,
        cursor: 'help',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          flexShrink: 0,
        }}
      >
        ⚠️
      </span>
      Higher token usage
    </span>
  )
}

export default AgentWarningBadge