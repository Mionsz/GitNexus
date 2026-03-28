import { describe, it, expect } from 'vitest';

// Import the function we'll add in the next step
import { isAzureProvider, isReasoningModel, buildRequestUrl } from '../../src/core/wiki/llm-client.js';

describe('isAzureProvider', () => {
  it('returns true for .openai.azure.com URLs', () => {
    expect(isAzureProvider('https://myresource.openai.azure.com/openai/v1')).toBe(true);
  });

  it('returns true for .services.ai.azure.com URLs', () => {
    expect(isAzureProvider('https://myresource.services.ai.azure.com/openai/v1')).toBe(true);
  });

  it('returns false for openai.com', () => {
    expect(isAzureProvider('https://api.openai.com/v1')).toBe(false);
  });

  it('returns false for openrouter', () => {
    expect(isAzureProvider('https://openrouter.ai/api/v1')).toBe(false);
  });
});

describe('isReasoningModel', () => {
  it('detects o1 model', () => {
    expect(isReasoningModel('o1')).toBe(true);
    expect(isReasoningModel('o1-mini')).toBe(true);
  });

  it('detects o3 model', () => {
    expect(isReasoningModel('o3')).toBe(true);
    expect(isReasoningModel('o3-mini')).toBe(true);
  });

  it('detects o4-mini', () => {
    expect(isReasoningModel('o4-mini')).toBe(true);
  });

  it('returns false for gpt-4o', () => {
    expect(isReasoningModel('gpt-4o')).toBe(false);
  });

  it('returns false for minimax', () => {
    expect(isReasoningModel('minimax/minimax-m2.5')).toBe(false);
  });

  it('respects explicit override', () => {
    expect(isReasoningModel('my-azure-deployment', true)).toBe(true);
    expect(isReasoningModel('o1', false)).toBe(false);
  });
});

describe('buildRequestUrl', () => {
  it('appends /chat/completions to plain base URL', () => {
    expect(buildRequestUrl('https://api.openai.com/v1', undefined)).toBe(
      'https://api.openai.com/v1/chat/completions'
    );
  });

  it('strips trailing slash before appending', () => {
    expect(buildRequestUrl('https://api.openai.com/v1/', undefined)).toBe(
      'https://api.openai.com/v1/chat/completions'
    );
  });

  it('appends api-version query param when provided', () => {
    expect(buildRequestUrl('https://myres.openai.azure.com/openai/deployments/dep1', '2024-10-21')).toBe(
      'https://myres.openai.azure.com/openai/deployments/dep1/chat/completions?api-version=2024-10-21'
    );
  });

  it('does not append api-version when undefined', () => {
    expect(buildRequestUrl('https://myres.openai.azure.com/openai/v1', undefined)).toBe(
      'https://myres.openai.azure.com/openai/v1/chat/completions'
    );
  });
});
