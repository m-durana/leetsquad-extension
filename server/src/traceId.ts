import { randomBytes } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';

export interface TracedRequest extends Request {
  traceId?: string;
}

export function traceIdMiddleware(req: TracedRequest, res: Response, next: NextFunction): void {
  const inbound = req.header('x-trace-id');
  const id = inbound && /^[a-zA-Z0-9_-]{1,64}$/.test(inbound) ? inbound : randomBytes(6).toString('hex');
  req.traceId = id;
  res.setHeader('x-trace-id', id);
  next();
}
