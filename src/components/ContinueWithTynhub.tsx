import { useAuthProviders } from '../hooks/useAuthProviders';
import { tynhubStartUrl } from '../services/tynhubService';

/**
 * "Continue with TynHub" button plus an "or" divider, shown above the
 * login/register form only when the server offers TynHub sign-in (hosted
 * AutoMarketer). A plain link: the whole page goes to TynHub and back.
 */
export default function ContinueWithTynhub({ next }: { next: string }) {
  const providers = useAuthProviders();
  if (!providers?.tynhub) return null;

  return (
    <div style={{ marginBottom: '20px' }}>
      <a
        href={tynhubStartUrl(next)}
        style={{
          display: 'block',
          width: '100%',
          padding: '11px',
          boxSizing: 'border-box',
          textAlign: 'center',
          background: 'var(--panel)',
          border: '1px solid var(--btn-line)',
          borderRadius: '10px',
          color: 'var(--ink)',
          fontSize: '14px',
          fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        Continue with {providers.tynhub.name}
      </a>
      <div
        aria-hidden="true"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginTop: '20px',
          color: 'var(--muted)',
          fontSize: '12px',
        }}
      >
        <span style={{ flex: 1, height: '1px', background: 'var(--line)' }} />
        or
        <span style={{ flex: 1, height: '1px', background: 'var(--line)' }} />
      </div>
    </div>
  );
}
