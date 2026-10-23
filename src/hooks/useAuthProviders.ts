import { useEffect, useState } from 'react';
import { fetchAuthProviders, type AuthProviders } from '../services/tynhubService';

/** Loads /api/auth/providers once (public endpoint); null until it answers. */
export function useAuthProviders(): AuthProviders | null {
  const [providers, setProviders] = useState<AuthProviders | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchAuthProviders().then((p) => {
      if (alive) setProviders(p);
    });
    return () => {
      alive = false;
    };
  }, []);
  return providers;
}
