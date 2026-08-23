/**
 * Engine registry. Resolves the active engine (and any engine by id) from the
 * `claude` / `codex` implementations. Kept separate from engine.ts so that the
 * runners can import the shared types without a circular dependency.
 */
import { getEngineId, type Engine, type EngineId } from './engine.ts';
import { claudeEngine } from './claude-runner.ts';
import { codexEngine } from './codex-runner.ts';

const ENGINES: Record<EngineId, Engine> = {
  claude: claudeEngine,
  codex: codexEngine,
};

export function getEngine(id: EngineId): Engine {
  return ENGINES[id];
}

export function currentEngine(): Engine {
  return ENGINES[getEngineId()];
}
