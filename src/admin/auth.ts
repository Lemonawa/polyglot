import type { MiddlewareHandler } from "hono";

/**
 * Hono middleware that requires a valid admin bearer token.
 *
 * Fail-closed: if the configured token is empty, all requests receive 401.
 * Expects header: `Authorization: Bearer <token>`.
 */
export function requireAdmin(token: string): MiddlewareHandler {
  return async (c, next) => {
    // Fail closed: empty configured token denies all access
    if (!token) {
      return c.text("Unauthorized", 401);
    }

    const authHeader = c.req.header("authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.text("Unauthorized", 401);
    }

    const providedToken = authHeader.slice(7); // "Bearer ".length

    if (providedToken !== token) {
      return c.text("Unauthorized", 401);
    }

    await next();
  };
}
