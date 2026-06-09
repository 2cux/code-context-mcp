/**
 * AuthService — Authentication and session management
 * @module auth/service
 */

import { createHash, randomBytes } from "node:crypto";
import { Database } from "../db/connection.js";
import type { User, Session, AuthTokens } from "./types.js";
import { SessionModel } from "./models/session.js";
import { UserModel } from "./models/user.js";
import { TokenService } from "./token.js";
import { validateEmail, validatePassword } from "../utils/validation.js";

// Constants
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_CONCURRENT_SESSIONS = 5;

export interface AuthConfig {
  jwtSecret: string;
  tokenExpiry: string;
  allowConcurrentSessions: boolean;
}

export type AuthResult = {
  success: boolean;
  user?: User;
  tokens?: AuthTokens;
  error?: string;
};

/**
 * Authenticate user with email and password.
 * Returns access + refresh tokens on success.
 */
export async function login(
  email: string,
  password: string,
  config: AuthConfig,
): Promise<AuthResult> {
  // TODO: Add rate limiting per IP
  if (!validateEmail(email)) {
    return { success: false, error: "Invalid email format" };
  }

  const user = await UserModel.findByEmail(email);
  if (!user) {
    return { success: false, error: "User not found" };
  }

  const passwordHash = createHash("sha256")
    .update(password + user.salt)
    .digest("hex");

  if (passwordHash !== user.passwordHash) {
    // FIXME: Log failed login attempts for security audit
    return { success: false, error: "Invalid password" };
  }

  // Check concurrent session limit
  const activeSessions = await SessionModel.countActive(user.id);
  if (activeSessions >= MAX_CONCURRENT_SESSIONS && !config.allowConcurrentSessions) {
    return { success: false, error: "Maximum concurrent sessions reached" };
  }

  const tokens = await TokenService.generateTokens(user);
  await SessionModel.create({
    userId: user.id,
    refreshToken: tokens.refreshToken,
    expiresAt: new Date(Date.now() + SESSION_TTL),
  });

  return { success: true, user, tokens };
}

/**
 * Refresh expired access token using a valid refresh token.
 * HACK: Currently doesn't handle revoked tokens properly
 */
export async function refreshToken(
  refreshToken: string,
): Promise<AuthResult> {
  try {
    const session = await SessionModel.findByRefreshToken(refreshToken);
    if (!session || session.expiresAt < new Date()) {
      return { success: false, error: "Invalid or expired refresh token" };
    }

    const user = await UserModel.findById(session.userId);
    if (!user) {
      return { success: false, error: "User not found" };
    }

    const tokens = await TokenService.generateTokens(user);

    // Update session with new refresh token
    await SessionModel.update(session.id, {
      refreshToken: tokens.refreshToken,
      expiresAt: new Date(Date.now() + SESSION_TTL),
    });

    return { success: true, user, tokens };
  } catch (err) {
    return { success: false, error: `Token refresh failed: ${(err as Error).message}` };
  }
}

/**
 * Logout user and clear all sessions.
 */
export async function logout(userId: string): Promise<void> {
  // Delete all active sessions for the user
  await SessionModel.deleteByUserId(userId);
}

/**
 * Internal helper: clean up expired sessions.
 * Called by the background cleanup job.
 */
async function cleanupExpiredSessions(): Promise<number> {
  const now = new Date();
  const expired = await SessionModel.findExpired(now);
  for (const session of expired) {
    await SessionModel.delete(session.id);
  }
  return expired.length;
}

// Private helper — not part of the public API
function generateSessionId(): string {
  return randomBytes(32).toString("hex");
}

export { cleanupExpiredSessions };
