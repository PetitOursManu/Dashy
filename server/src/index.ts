import { env } from './config/env.js';
import { connectDb } from './config/db.js';
import { ensureDataDirs } from './config/paths.js';
import { seedAdmin } from './services/seed.js';
import { createApp } from './app.js';

async function main(): Promise<void> {
  ensureDataDirs();
  await connectDb();
  await seedAdmin();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`[server] Dashy listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = (signal: string) => {
    console.log(`[server] ${signal} received, shutting down...`);
    server.close(() => process.exit(0));
    // Force-exit if connections linger.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[server] Fatal startup error:', err);
  process.exit(1);
});
