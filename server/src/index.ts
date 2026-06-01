import { createApp } from './app';
import { config } from './config';
import { sweepExpiredNonces } from './db';

const app = createApp();

setInterval(sweepExpiredNonces, 5 * 60_000).unref();

app.listen(config.port, () => {
  console.log(`leetsquad-server listening on :${config.port}`);
});
