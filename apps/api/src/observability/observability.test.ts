import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import type { FastifyInstance } from 'fastify';
import { createTestApp, recordOrchestratorTick } from '../app.js';

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let app: FastifyInstance;

describe('Observability (integration)', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    client = new MongoClient(mongod.getUri());
    await client.connect();
    db = client.db('test_observability');
    app = await createTestApp(db);
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await client.close();
    await mongod.stop();
  });

  // ── Correlation ID ───────────────────────────────────

  describe('Correlation ID', () => {
    it('returns x-correlation-id header in every response', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-correlation-id']).toBeDefined();
      expect(typeof res.headers['x-correlation-id']).toBe('string');
    });

    it('returns consistent correlation id across /health calls', async () => {
      const res1 = await app.inject({ method: 'GET', url: '/health' });
      const res2 = await app.inject({ method: 'GET', url: '/health' });

      // Each request gets its own unique id
      expect(res1.headers['x-correlation-id']).not.toBe(
        res2.headers['x-correlation-id'],
      );
    });
  });

  // ── /ready endpoint ──────────────────────────────────

  describe('GET /ready', () => {
    it('returns 200 when MongoDB is healthy and no stale heartbeat', async () => {
      // Record a fresh tick so the staleness check passes
      recordOrchestratorTick();

      const res = await app.inject({
        method: 'GET',
        url: '/ready',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('ok');
    });

    it('returns 503 when orchestrator heartbeat is stale', async () => {
      // Simulate a stale heartbeat by going back in time
      // We can't easily mock Date.now() here without affecting MongoDB,
      // so we test by not recording any tick (lastTickTimestamp stays at
      // a past value or 0). Let's set it far in the past via a workaround:

      // Record a tick that will be stale (> READY_STALENESS_MS ago)
      // We need to manipulate the internal state.
      // The simplest approach: create a new test app with a very short staleness
      // and wait, OR we override the heartbeat timestamp.

      // For this test, we'll use vi.useFakeTimers to advance time.
      vi.useFakeTimers();
      recordOrchestratorTick(); // sets lastTickTimestamp to mocked "now"
      vi.advanceTimersByTime(120_000); // advance 2 minutes past the 60s threshold

      const res = await app.inject({
        method: 'GET',
        url: '/ready',
      });

      vi.useRealTimers();

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.status).toBe('error');
      expect(body.checks.orchestrator).toBeDefined();
      expect(body.checks.orchestrator).toContain('ago');
    });
  });

  // ── App starts without SENTRY_DSN ────────────────────

  describe('No SENTRY_DSN', () => {
    it('app starts normally when SENTRY_DSN is not set', async () => {
      // The test app is already created without SENTRY_DSN — if we got
      // here, the app started successfully without Sentry.
      const res = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(res.statusCode).toBe(200);
    });
  });
});
