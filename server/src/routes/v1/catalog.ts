import { Router, Response, NextFunction } from 'express';
import { stmts } from '../../db';
import { ApiError } from '../../errorEnvelope';
import { ApiKeyedRequest, optionalApiKey } from '../../apiKeyMiddleware';

export const v1CatalogRouter = Router();

v1CatalogRouter.get('/', optionalApiKey, (_req: ApiKeyedRequest, res: Response, next: NextFunction) => {
  try {
    const row = stmts.getProblemCatalog.get() as
      | { catalog_json: string; updated_at: number; total_count: number }
      | undefined;
    if (!row) throw new ApiError('not_ready', 'catalog has not been refreshed yet');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400');
    res.type('application/json').send(
      `{"updated_at":${row.updated_at},"total_count":${row.total_count},"problems":${row.catalog_json}}`
    );
  } catch (e) {
    next(e);
  }
});
