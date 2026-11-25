import type { ApiKey, User } from '@neuron/db';
import type { Request } from 'express';

/** A request after SessionGuard or ApiKeyGuard has identified the caller. */
export interface AuthenticatedRequest extends Request {
  user?: User;
  apiKey?: ApiKey;
}
