import type { FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';

export const clientIpHeader = 'x-reasoningapp-client-ip';

/** trustProxy is false. Overwrite the client's value with the trusted socket IP;
 * Better Auth reads only this header, never arbitrary forwarding headers. */
export function authHeaders(request: FastifyRequest): Headers {
  const headers = fromNodeHeaders(request.headers);
  headers.set(clientIpHeader, request.ip);
  return headers;
}
