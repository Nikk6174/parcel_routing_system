// ── Pipeline ─────────────────────────────────────────────
export { PipelineOrchestrator } from './orchestrator.js';
export { ResultBuffer } from './result-buffer.js';
export { default as evaluateParcel } from './worker.js';

// ── Types & Config ──────────────────────────────────────
export { DEFAULT_PIPELINE_CONFIG } from './types.js';
export type {
  WorkerInput,
  WorkerOutput,
  PipelineResult,
  PipelineConfig,
  WorkerPool,
  Logger,
} from './types.js';
