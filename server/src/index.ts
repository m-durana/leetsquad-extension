import { createApp } from './app';
import { config } from './config';
import { sweepExpiredNonces } from './db';
import { startStatsAggregator } from './statsAggregator';

const app = createApp();

setInterval(sweepExpiredNonces, 5 * 60_000).unref();
startStatsAggregator();

app.listen(config.port, () => {
  console.log(`leetsquad-server listening on :${config.port}`);
});
