import type { FastifyRequest, FastifyReply } from 'fastify';
import { createSecretKey } from 'node:crypto';
import { jwtVerify, type KeyLike } from 'jose';

/**
 * Valid application roles.
 * These match the `role` claim expected inside the JWT payload.
 */
export type AppRole = 'operator' | 'insurance_approver' | 'admin';

/** Decoded JWT payload shape (only the claims we use). */
interface JwtClaims {
  sub: string;
  role: AppRole;
  iat?: number;
  exp?: number;
}

/**
 * Singleton secret key — created once from the JWT_SECRET env var.
 *
 * PRODUCTION NOTE:
 * In production you'd typically validate against a JWKS endpoint
 * (e.g. `jose.createRemoteJWKSet(new URL('https://idp/.well-known/jwks.json'))`)
 * rather than a symmetric secret. This keeps the app decoupled from
 * the identity provider and allows key rotation without app redeployment.
 */
let secretKey: KeyLike | undefined;

/**
 * Initialize the JWT verification key.
 * Must be called once at app startup before any requests arrive.
 *
 * @param secret The JWT_SECRET from env config.
 * @throws If the secret is empty or too short (< 32 chars).
 */
export function initJwtSecret(secret: string): void {
  if (secret.length < 32) {
    throw new Error(
      'JWT_SECRET must be at least 32 characters for HS256 security',
    );
  }
  secretKey = createSecretKey(Buffer.from(secret, 'utf-8'));
}

/**
 * Get the configured secret key.
 * Exported for test utilities that need to sign test tokens.
 */
export function getSecretKey(): KeyLike {
  if (!secretKey) {
    throw new Error('JWT secret not initialized — call initJwtSecret() first');
  }
  return secretKey;
}

/**
 * JWT authentication + role authorization middleware.
 *
 * Replaces the Phase 5 X-Role header stub with real JWT verification.
 * Expects: `Authorization: Bearer <token>` header.
 *
 * The token must contain a `role` claim matching the required role.
 *
 * @param requiredRole The role required to access the endpoint.
 */
export function authorize(requiredRole: AppRole) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      await reply.status(401).send({
        status: 'error' as const,
        error: 'Missing or malformed Authorization header. Expected: Bearer <token>',
      });
      return;
    }

    const token = authHeader.slice(7); // Strip "Bearer "

    if (!secretKey) {
      request.log.error('JWT secret not initialized');
      await reply.status(500).send({
        status: 'error' as const,
        error: 'Server authentication misconfigured',
      });
      return;
    }

    try {
      const { payload } = await jwtVerify(token, secretKey, {
        algorithms: ['HS256'],
      });

      const claims = payload as unknown as JwtClaims;

      if (!claims.role) {
        await reply.status(403).send({
          status: 'error' as const,
          error: 'Token missing required "role" claim',
        });
        return;
      }

      if (claims.role !== requiredRole) {
        await reply.status(403).send({
          status: 'error' as const,
          error: `Forbidden: requires role "${requiredRole}", token has "${claims.role}"`,
        });
        return;
      }

      // Attach decoded claims to the request for downstream handlers.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (request as Record<string, unknown>)['user'] = {
        sub: claims.sub,
        role: claims.role,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      // jose throws specific error codes for expired, malformed, etc.
      const isExpired = message.includes('"exp" claim');
      const statusMessage = isExpired
        ? 'Token expired'
        : 'Invalid or expired token';

      request.log.warn({ error: message }, 'JWT verification failed');

      await reply.status(401).send({
        status: 'error' as const,
        error: statusMessage,
      });
    }
  };
}
