import type { Request, Response } from 'express';
import { buildApp } from '../src/app.js';

let app: ReturnType<typeof buildApp> | null = null;

export default async function handler(req: Request, res: Response) {
  try {
    if (!app) {
      app = buildApp();
    }
    return app(req, res);
  } catch (err: any) {
    console.error('Vercel serverless handler error:', err);
    return res.status(500).json({
      error: {
        code: 'SERVERLESS_INIT_ERROR',
        message: err?.message ?? String(err),
      },
    });
  }
}

