import { Request, Response, NextFunction } from 'express';
import { TracedRequest } from './traceId';

const ERROR_STATUS: Record<string, number> = {
  bad_username: 400,
  invalid_username: 400,
  bad_slug: 400,
  bad_cursor: 400,
  bad_limit: 400,
  bad_since: 400,
  bad_body: 400,
  missing_token: 401,
  invalid_token: 401,
  missing_key: 401,
  invalid_key: 401,
  revoked_key: 403,
  forbidden: 403,
  not_found: 404,
  not_owner: 403,
  too_many_requests: 429,
  leetcode_unreachable: 502,
  internal: 500,
};

export class ApiError extends Error {
  code: string;
  status: number;
  detail?: string;

  constructor(code: string, message?: string, detail?: string) {
    super(message ?? code);
    this.code = code;
    this.status = ERROR_STATUS[code] ?? 500;
    if (detail !== undefined) this.detail = detail;
  }
}

export function sendError(res: Response, traceId: string | undefined, err: ApiError | Error): Response {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: err.code,
      message: err.message,
      ...(err.detail !== undefined ? { detail: err.detail } : {}),
      trace_id: traceId,
    });
  }
  return res.status(500).json({ error: 'internal', message: 'internal error', trace_id: traceId });
}

export function v1ErrorHandler(err: unknown, req: TracedRequest, res: Response, _next: NextFunction): void {
  if (res.headersSent) return;
  if (err instanceof ApiError) {
    sendError(res, req.traceId, err);
    return;
  }
  const msg = err instanceof Error ? err.message : 'internal error';
  console.error(`[v1] ${req.traceId ?? '?'} ${req.method} ${req.path}: ${msg}`);
  sendError(res, req.traceId, new ApiError('internal', 'internal error'));
}
