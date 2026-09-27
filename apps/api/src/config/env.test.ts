import { describe, it, expect } from 'vitest';
import { loadConfig } from './env.js';

describe('loadConfig', () => {
  // ── Happy path ──────────────────────────────────────
  it('returns valid config when all env vars are provided', () => {
    const env = {
      PORT: '4000',
      MONGO_URI: 'mongodb://localhost:27017/parcel-routing',
      LOG_LEVEL: 'debug',
      RATE_LIMIT_MAX: '200',
      RATE_LIMIT_WINDOW_MS: '30000',
      JWT_SECRET: 'test-secret-key-that-is-at-least-32-characters-long',
    };

    const config = loadConfig(env);

    expect(config.PORT).toBe(4000);
    expect(config.MONGO_URI).toBe('mongodb://localhost:27017/parcel-routing');
    expect(config.LOG_LEVEL).toBe('debug');
    expect(config.RATE_LIMIT_MAX).toBe(200);
    expect(config.RATE_LIMIT_WINDOW_MS).toBe(30000);
  });

  // ── Defaults ────────────────────────────────────────
  it('uses defaults for optional vars when only MONGO_URI is set', () => {
    const env = {
      MONGO_URI: 'mongodb://localhost:27017/test',
      JWT_SECRET: 'test-secret-key-that-is-at-least-32-characters-long',
    };

    const config = loadConfig(env);

    expect(config.PORT).toBe(3001);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.RATE_LIMIT_MAX).toBe(100);
    expect(config.RATE_LIMIT_WINDOW_MS).toBe(60_000);
  });

  // ── Boundary: minimum valid PORT ────────────────────
  it('accepts PORT=1 as a valid boundary value', () => {
    const env = {
      MONGO_URI: 'mongodb://localhost:27017/test',
      PORT: '1',
      JWT_SECRET: 'test-secret-key-that-is-at-least-32-characters-long',
    };

    const config = loadConfig(env);

    expect(config.PORT).toBe(1);
  });

  // ── Invalid input: missing required var ─────────────
  it('throws when MONGO_URI is missing', () => {
    expect(() => loadConfig({})).toThrow('Invalid environment configuration');
  });

  // ── Invalid input: empty MONGO_URI ──────────────────
  it('throws when MONGO_URI is an empty string', () => {
    const env = { MONGO_URI: '' };

    expect(() => loadConfig(env)).toThrow('Invalid environment configuration');
  });

  // ── Invalid input: bad enum value ───────────────────
  it('throws when LOG_LEVEL is not a recognised value', () => {
    const env = {
      MONGO_URI: 'mongodb://localhost:27017/test',
      LOG_LEVEL: 'verbose',
      JWT_SECRET: 'test-secret-key-that-is-at-least-32-characters-long',
    };

    expect(() => loadConfig(env)).toThrow('Invalid environment configuration');
  });

  // ── Boundary: PORT=0 is not positive ────────────────
  it('throws when PORT is zero', () => {
    const env = {
      MONGO_URI: 'mongodb://localhost:27017/test',
      PORT: '0',
      JWT_SECRET: 'test-secret-key-that-is-at-least-32-characters-long',
    };

    expect(() => loadConfig(env)).toThrow('Invalid environment configuration');
  });

  // ── Invalid input: non-numeric PORT ─────────────────
  it('throws when PORT is not a number', () => {
    const env = {
      MONGO_URI: 'mongodb://localhost:27017/test',
      PORT: 'abc',
      JWT_SECRET: 'test-secret-key-that-is-at-least-32-characters-long',
    };

    expect(() => loadConfig(env)).toThrow('Invalid environment configuration');
  });
});
