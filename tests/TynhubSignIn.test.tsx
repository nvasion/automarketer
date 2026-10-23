import type { ReactNode } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Login from '../src/pages/Login';
import Register from '../src/pages/Register';
import TynhubAccountCard from '../src/components/TynhubAccountCard';
import { AuthContext } from '../src/contexts/AuthContext';
import type { PublicUser } from '../src/services/authService';
import { safeNext, tynhubStartUrl } from '../src/services/tynhubService';

type Routes = Record<string, { status?: number; body: unknown }>;

/** Stubs fetch with canned JSON per "METHOD path"; records the calls. */
function stubFetch(routes: Routes) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`;
    const route = routes[key];
    if (!route) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const authValue = (user: PublicUser | null = null) => ({
  user,
  loading: false,
  login: vi.fn().mockResolvedValue(undefined),
  register: vi.fn().mockResolvedValue(undefined),
  logout: vi.fn().mockResolvedValue(undefined),
});

function renderAt(path: string, ui: ReactNode, user: PublicUser | null = null) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthContext.Provider value={authValue(user)}>{ui}</AuthContext.Provider>
    </MemoryRouter>,
  );
}

const TYNHUB_ON = { 'GET /api/auth/providers': { body: { tynhub: { name: 'TynHub' } } } };
const TYNHUB_OFF = { 'GET /api/auth/providers': { body: { tynhub: null } } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Continue with TynHub on the auth pages', () => {
  it('Login shows the button when the server offers TynHub, linking to start with a safe next', async () => {
    stubFetch(TYNHUB_ON);
    renderAt('/login?next=/campaigns', <Login />);
    const link = await screen.findByRole('link', { name: 'Continue with TynHub' });
    expect(link).toHaveAttribute('href', '/api/auth/tynhub/start?next=%2Fcampaigns');
    // The password form is still there below it.
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('Login hides the button when TynHub is not configured', async () => {
    const fetchMock = stubFetch(TYNHUB_OFF);
    renderAt('/login', <Login />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/providers', expect.anything()));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('link', { name: /continue with tynhub/i })).not.toBeInTheDocument();
  });

  it('Login shows ?error= as text in the error banner (never as HTML)', async () => {
    stubFetch(TYNHUB_ON);
    renderAt('/login?error=%3Cb%3EAn%20account%20with%20this%20email%20already%20exists%3C%2Fb%3E', <Login />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('<b>An account with this email already exists</b>');
    expect(alert.querySelector('b')).toBeNull();
    await screen.findByRole('link', { name: 'Continue with TynHub' });
  });

  it('Register offers the button too, ignoring an unsafe next', async () => {
    stubFetch(TYNHUB_ON);
    renderAt('/register?next=//evil.example', <Register />);
    const link = await screen.findByRole('link', { name: 'Continue with TynHub' });
    expect(link).toHaveAttribute('href', '/api/auth/tynhub/start?next=%2F');
  });

  it('client safeNext and start URL match the server rules', () => {
    expect(safeNext('/settings')).toBe('/settings');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('/\\evil')).toBe('/');
    expect(safeNext(null)).toBe('/');
    expect(tynhubStartUrl('/settings', true)).toBe('/api/auth/tynhub/start?next=%2Fsettings&link=1');
  });
});

describe('Settings TynHub account card', () => {
  const pwUser: PublicUser = { id: 'u1', email: 'a@example.com', createdAt: '2026-01-01T00:00:00Z', hasPassword: true };

  it('renders nothing when TynHub is not configured', async () => {
    const fetchMock = stubFetch(TYNHUB_OFF);
    renderAt('/settings', <TynhubAccountCard />, pwUser);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('tynhub-account-card')).not.toBeInTheDocument();
  });

  it('offers Connect TynHub when not linked', async () => {
    stubFetch({ ...TYNHUB_ON, 'GET /api/auth/identities': { body: [] } });
    renderAt('/settings', <TynhubAccountCard />, pwUser);
    const link = await screen.findByRole('link', { name: 'Connect TynHub' });
    expect(link).toHaveAttribute('href', '/api/auth/tynhub/start?next=%2Fsettings&link=1');
  });

  it('shows Connected and disconnects a user who has a password', async () => {
    const fetchMock = stubFetch({
      ...TYNHUB_ON,
      'GET /api/auth/identities': { body: [{ provider: 'tynhub', linkedAt: '2026-10-22T00:00:00Z' }] },
      'DELETE /api/auth/identities/tynhub': { body: { unlinked: true } },
    });
    renderAt('/settings', <TynhubAccountCard />, pwUser);
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByRole('link', { name: 'Connect TynHub' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/identities/tynhub', expect.objectContaining({ method: 'DELETE' }));
  });

  it('hides Disconnect for a TynHub-only account and shows ?tynhub_error=', async () => {
    stubFetch({
      ...TYNHUB_ON,
      'GET /api/auth/identities': { body: [{ provider: 'tynhub', linkedAt: '2026-10-22T00:00:00Z' }] },
    });
    renderAt(
      '/settings?tynhub_error=That%20TynHub%20account%20is%20already%20linked',
      <TynhubAccountCard />,
      { ...pwUser, hasPassword: false },
    );
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('That TynHub account is already linked');
  });
});
