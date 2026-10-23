export interface User {
  id: string;
  email: string;
  /** null for accounts created through "Continue with TynHub" (no password). */
  passwordHash: string | null;
  createdAt: string;
}

export interface PublicUser {
  id: string;
  email: string;
  createdAt: string;
  /** False for TynHub-only accounts: they cannot password-login or unlink TynHub. */
  hasPassword: boolean;
}

export interface JwtPayload {
  sub: string; // user id
  email: string;
  iat?: number;
  exp?: number;
}

// Augment Express Request so TypeScript knows about req.user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}
