import { describe, it, expect } from 'vitest';
import {
  BindingAccumulator,
  type BindingEntry,
} from '../../src/core/ingestion/binding-accumulator.js';

describe('BindingAccumulator', () => {
  describe('append + read', () => {
    it('returns entries for a single file', () => {
      const acc = new BindingAccumulator();
      const entries: BindingEntry[] = [
        { scope: '', varName: 'x', typeName: 'number' },
        { scope: 'foo@10', varName: 'y', typeName: 'string' },
      ];
      acc.appendFile('src/a.ts', entries);
      expect(acc.getFile('src/a.ts')).toEqual(entries);
    });

    it('returns entries for multiple files', () => {
      const acc = new BindingAccumulator();
      acc.appendFile('src/a.ts', [{ scope: '', varName: 'a', typeName: 'number' }]);
      acc.appendFile('src/b.ts', [{ scope: '', varName: 'b', typeName: 'string' }]);
      expect(acc.getFile('src/a.ts')).toHaveLength(1);
      expect(acc.getFile('src/b.ts')).toHaveLength(1);
      expect(acc.fileCount).toBe(2);
    });

    it('returns undefined for unknown file', () => {
      const acc = new BindingAccumulator();
      expect(acc.getFile('nonexistent.ts')).toBeUndefined();
    });

    it('accumulates entries across multiple calls for the same file', () => {
      const acc = new BindingAccumulator();
      acc.appendFile('src/a.ts', [{ scope: '', varName: 'x', typeName: 'number' }]);
      acc.appendFile('src/a.ts', [{ scope: 'fn@5', varName: 'y', typeName: 'boolean' }]);
      const entries = acc.getFile('src/a.ts');
      expect(entries).toHaveLength(2);
      expect(entries![0].varName).toBe('x');
      expect(entries![1].varName).toBe('y');
    });

    it('skips append when entries is empty', () => {
      const acc = new BindingAccumulator();
      acc.appendFile('src/a.ts', []);
      expect(acc.getFile('src/a.ts')).toBeUndefined();
      expect(acc.fileCount).toBe(0);
    });

    it('tracks totalBindings correctly', () => {
      const acc = new BindingAccumulator();
      acc.appendFile('src/a.ts', [
        { scope: '', varName: 'x', typeName: 'number' },
        { scope: '', varName: 'y', typeName: 'string' },
      ]);
      acc.appendFile('src/b.ts', [{ scope: '', varName: 'z', typeName: 'boolean' }]);
      expect(acc.totalBindings).toBe(3);
    });
  });

  describe('finalize + immutability', () => {
    it('finalize prevents further appends', () => {
      const acc = new BindingAccumulator();
      acc.appendFile('src/a.ts', [{ scope: '', varName: 'x', typeName: 'number' }]);
      acc.finalize();
      expect(() =>
        acc.appendFile('src/b.ts', [{ scope: '', varName: 'y', typeName: 'string' }]),
      ).toThrow(/finalized/);
    });

    it('finalized getter returns true after finalize', () => {
      const acc = new BindingAccumulator();
      expect(acc.finalized).toBe(false);
      acc.finalize();
      expect(acc.finalized).toBe(true);
    });

    it('getFile works after finalize', () => {
      const acc = new BindingAccumulator();
      acc.appendFile('src/a.ts', [{ scope: '', varName: 'x', typeName: 'number' }]);
      acc.finalize();
      expect(acc.getFile('src/a.ts')).toHaveLength(1);
    });

    it('finalize is idempotent', () => {
      const acc = new BindingAccumulator();
      acc.finalize();
      expect(() => acc.finalize()).not.toThrow();
    });
  });

  describe('fileScopeEntries', () => {
    it('returns only scope="" entries as [varName, typeName] tuples', () => {
      const acc = new BindingAccumulator();
      acc.appendFile('src/a.ts', [
        { scope: '', varName: 'x', typeName: 'number' },
        { scope: 'foo@10', varName: 'y', typeName: 'string' },
        { scope: '', varName: 'z', typeName: 'boolean' },
      ]);
      const tuples = acc.fileScopeEntries('src/a.ts');
      expect(tuples).toEqual([
        ['x', 'number'],
        ['z', 'boolean'],
      ]);
    });

    it('returns empty array for unknown file', () => {
      const acc = new BindingAccumulator();
      expect(acc.fileScopeEntries('nonexistent.ts')).toEqual([]);
    });

    it('returns empty array when file has no file-scope entries', () => {
      const acc = new BindingAccumulator();
      acc.appendFile('src/a.ts', [{ scope: 'fn@1', varName: 'x', typeName: 'number' }]);
      expect(acc.fileScopeEntries('src/a.ts')).toEqual([]);
    });
  });

  describe('iteration', () => {
    it('files() yields all file paths', () => {
      const acc = new BindingAccumulator();
      acc.appendFile('src/a.ts', [{ scope: '', varName: 'x', typeName: 'number' }]);
      acc.appendFile('src/b.ts', [{ scope: '', varName: 'y', typeName: 'string' }]);
      acc.appendFile('src/c.ts', [{ scope: '', varName: 'z', typeName: 'boolean' }]);
      const paths = [...acc.files()];
      expect(paths.sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    });

    it('files() returns empty iterator when no files added', () => {
      const acc = new BindingAccumulator();
      expect([...acc.files()]).toEqual([]);
    });
  });

  describe('memory estimate', () => {
    it('returns a reasonable estimate for 1000 files x 2 entries', () => {
      const acc = new BindingAccumulator();
      for (let i = 0; i < 1000; i++) {
        acc.appendFile(`src/file${i}.ts`, [
          { scope: '', varName: `var${i}a`, typeName: 'string' },
          { scope: `fn${i}@0`, varName: `var${i}b`, typeName: 'number' },
        ]);
      }
      const bytes = acc.estimateMemoryBytes();
      // Should be between 50KB and 2MB
      expect(bytes).toBeGreaterThan(50 * 1024);
      expect(bytes).toBeLessThan(2 * 1024 * 1024);
    });
  });
});
