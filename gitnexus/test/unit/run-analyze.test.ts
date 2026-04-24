import { describe, it, expect } from 'vitest';

describe('run-analyze module', () => {
  it('exports runFullAnalysis as a function', async () => {
    const mod = await import('../../src/core/run-analyze.js');
    expect(typeof mod.runFullAnalysis).toBe('function');
  });

  it('exports PHASE_LABELS', async () => {
    const mod = await import('../../src/core/run-analyze.js');
    expect(mod.PHASE_LABELS).toBeDefined();
    expect(mod.PHASE_LABELS.parsing).toBe('Parsing code');
  });

  it('AnalyzeOptions accepts dropEmbeddings (compile-time check)', async () => {
    // Type-level smoke test: if the field is removed/renamed this won't compile.
    const mod = await import('../../src/core/run-analyze.js');
    const opts: import('../../src/core/run-analyze.js').AnalyzeOptions = {
      embeddings: false,
      dropEmbeddings: true,
    };
    expect(opts.dropEmbeddings).toBe(true);
    expect(typeof mod.runFullAnalysis).toBe('function');
  });
});
