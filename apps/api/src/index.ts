import { buildApp } from './app';
import { getDb } from './db/client';

const port = Number(process.env.PORT ?? 4000);
const server = buildApp().listen(port, () => {
  console.log(`Ottodot trial booking API listening on http://localhost:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(async () => {
      try {
        await getDb().$client.end();
      } catch {
        // ignore shutdown errors
      }
      process.exit(0);
    });
  });
}
