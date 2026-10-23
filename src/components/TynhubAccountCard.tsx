import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAuthProviders } from '../hooks/useAuthProviders';
import { fetchIdentities, tynhubStartUrl, unlinkTynhub, type LinkedIdentity } from '../services/tynhubService';

/**
 * Settings → Profile: connect or disconnect a TynHub account. Rendered only
 * when the server offers TynHub sign-in (hosted AutoMarketer). Connecting is
 * a full-page round trip through TynHub that comes back to /settings; a
 * failure comes back as /settings?tynhub_error=<message>.
 */
export default function TynhubAccountCard() {
  const providers = useAuthProviders();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [linked, setLinked] = useState<LinkedIdentity | null | undefined>(undefined);
  const [error, setError] = useState(() => searchParams.get('tynhub_error') ?? '');
  const [busy, setBusy] = useState(false);

  const enabled = Boolean(providers?.tynhub);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetchIdentities()
      .then((ids) => {
        if (alive) setLinked(ids.find((i) => i.provider === 'tynhub') ?? null);
      })
      .catch(() => {
        if (alive) setLinked(null);
      });
    return () => {
      alive = false;
    };
  }, [enabled]);

  if (!providers?.tynhub) return null;

  const disconnect = async () => {
    setBusy(true);
    setError('');
    try {
      await unlinkTynhub();
      setLinked(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect TynHub');
    } finally {
      setBusy(false);
    }
  };

  const buttonStyle = {
    background: 'var(--sunken)',
    border: '1px solid var(--line)',
    borderRadius: '8px',
    padding: '7px 14px',
    fontSize: '13px',
    color: 'var(--ink-2)',
    cursor: 'pointer',
    fontWeight: 500,
    textDecoration: 'none',
  } as const;

  return (
    <section
      data-testid="tynhub-account-card"
      style={{ border: '1px solid var(--line)', borderRadius: '10px', padding: '16px', marginBottom: '24px' }}
    >
      <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink)', marginBottom: '4px' }}>
        TynHub account
      </h3>
      <p style={{ color: 'var(--muted)', fontSize: '13px', marginBottom: '12px' }}>
        Sign in to AutoMarketer with your TynHub account.
      </p>

      {error && (
        <div
          role="alert"
          style={{
            background: 'var(--fail-soft)',
            border: '1px solid var(--fail-line)',
            borderRadius: '8px',
            padding: '10px 12px',
            color: 'var(--fail)',
            fontSize: '13px',
            marginBottom: '12px',
          }}
        >
          {error}
        </div>
      )}

      {linked === undefined ? null : linked ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span
            style={{
              background: 'var(--ok-soft)',
              border: '1px solid var(--ok-line)',
              color: 'var(--ok)',
              borderRadius: '999px',
              padding: '3px 10px',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            Connected
          </span>
          {user?.hasPassword === true && (
            <button type="button" style={buttonStyle} disabled={busy} onClick={() => void disconnect()}>
              {busy ? 'Disconnecting…' : 'Disconnect'}
            </button>
          )}
        </div>
      ) : (
        <a href={tynhubStartUrl('/settings', true)} style={buttonStyle}>
          Connect TynHub
        </a>
      )}
    </section>
  );
}
