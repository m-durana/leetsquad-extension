import { Router } from 'express';
import { getStatsPayload } from '../../statsAggregator';

export const v1StatsRouter = Router();

v1StatsRouter.get('/', (_req, res) => {
  const payload = getStatsPayload();
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.json(payload);
});
