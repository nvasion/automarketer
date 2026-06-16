import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Login from '../src/pages/Login';
import { AuthContext } from '../src/contexts/AuthContext';
import type { PublicUser } from '../src/services/authService';

// ── Test helpers ─────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

function makeContextValue(overrides: Partial<{
  user: PublicUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}> = {}) {
  return {
    user: null,
    loading: false,
    login: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderLogin(contextValue = makeContextValue()) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={contextValue}>
        <Login />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockNavigate.mockReset();
});

describe('Login page', () => {
  it('renders the email and password fields', () => {
    renderLogin();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
  });

  it('renders a submit button', () => {
    renderLogin();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('calls login with entered credentials on submit', async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    renderLogin(makeContextValue({ login }));

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^password/i), {
      target: { value: 'mypassword' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith('user@example.com', 'mypassword');
    });
  });

  it('navigates to / after a successful login', async () => {
    renderLogin(makeContextValue({ login: vi.fn().mockResolvedValue(undefined) }));

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^password/i), {
      target: { value: 'mypassword' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    });
  });

  it('displays an error message when login fails', async () => {
    const login = vi.fn().mockRejectedValue(new Error('Invalid email or password.'));
    renderLogin(makeContextValue({ login }));

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^password/i), {
      target: { value: 'wrongpassword' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password.');
    });
  });

  it('shows a loading state while submitting', async () => {
    let resolve!: () => void;
    const login = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolve = res;
        }),
    );
    renderLogin(makeContextValue({ login }));

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^password/i), {
      target: { value: 'mypassword' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveTextContent(/signing in/i);
    });

    // Resolve the promise inside act() so the state update is flushed cleanly
    await act(async () => {
      resolve();
    });
  });

  it('contains a link to the register page', () => {
    renderLogin();
    expect(screen.getByRole('link', { name: /create one/i })).toBeInTheDocument();
  });
});
