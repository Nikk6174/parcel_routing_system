import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Stub authorization middleware.
 *
 * Checks the `X-Role` header against the required role.
 * This is a placeholder — Phase 7 will wire in real JWT/session auth.
 *
 * @param requiredRole The role required to access the endpoint.
 */
export function authorize(requiredRole: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const role = request.headers['x-role'];

    if (typeof role !== 'string' || role !== requiredRole) {
      await reply.status(403).send({
        status: 'error' as const,
        error: `Forbidden: requires role "${requiredRole}"`,
      });
    }
  };
}
