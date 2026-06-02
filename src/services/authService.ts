/**
 * Auth service — thin fetch wrappers around /api/auth/* endpoints.
 *
 * Security note: tokens are stored exclusively in httpOnly cookies set by the
 * server. No token ever touches localStorage or JavaScript-accessible storage,
 * which eliminates the XSS-based session-hijacking risk that localStorage
 * creates.
 *
 * `credentials: 'include'` is required so the browser attaches the cookie to
 * every request (including cross-origin ones proxied through Vite's dev proxy).
 */

import { parseJsonBody } from '../utils/http';

const API_BASE = '/api/auth';

export interface PublicUser {
  id: string;
  email: string;
  createdAt: string;
}

interface AuthResponse {
  user: PublicUser;
}

class AuthError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(API_BASE + path, {
    ...options,
    credentials: 'include', // send & receive httpOnly cookies
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  // Always parse the body — error responses also contain JSON.
  // parseJsonBody reads as text first to produce a clear error when the server
  // returns an empty body (e.g. after a redirect or timeout).
  let data: { error?: string; code?: string } & T;
  try {
    data = await parseJsonBody<{ error?: string; code?: string } & T>(res);
  } catch {
    throw new AuthError(res.ok ? 'Received non-JSON response from server' : 'Request failed');
  }

  if (!res.ok) {
    throw new AuthError(data.error ?? 'Request failed', data.code);
  }

  return data;
}

export const authService = {
  register(email: string, password: string): Promise<AuthResponse> {
    return request<AuthResponse>('/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  login(email: string, password: string): Promise<AuthResponse> {
    return request<AuthResponse>('/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  /** Clears the httpOnly cookie server-side. */
  logout(): Promise<{ message: string }> {
    return request<{ message: string }>('/logout', { method: 'POST' });
  },

  /** Returns the currently authenticated user based on the cookie session. */
  me(): Promise<AuthResponse> {
    return request<AuthResponse>('/me');
  },
};
