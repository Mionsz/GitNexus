# Azure OpenAI Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the `gitnexus wiki` command to work correctly with Azure OpenAI, including proper auth headers, URL handling, api-version query param, reasoning model parameter stripping, content-filter error handling, and an Azure option in the interactive setup wizard.

**Architecture:** All changes are confined to three files: `llm-client.ts` (core HTTP logic), `repo-manager.ts` (config schema), and `wiki.ts` (interactive setup wizard). Azure is detected via a `provider` field in config or auto-detected from the base URL. Reasoning model detection uses a name-pattern heuristic that works for OpenAI direct and is overridable for Azure deployments via an explicit `isReasoningModel` flag.

**Tech Stack:** TypeScript, native `fetch`, vitest

---

## Issues Being Fixed

| # | Issue | Location |
|---|-------|----------|
| 1 | Wrong auth header — sends `Authorization: Bearer` but Azure requires `api-key` | `llm-client.ts:100-105` |
| 2 | `api-version` query param missing — Azure legacy API returns 404/400 without it | `llm-client.ts:83` |
| 3 | Reasoning models (o1, o3, o4-mini) reject `temperature` and `max_tokens` — need `max_completion_tokens` instead | `llm-client.ts:86-92` |
| 4 | `CLIConfig` has no `provider` or `apiVersion` fields — can't persist Azure config | `repo-manager.ts:321-325` |
| 5 | Interactive setup wizard has no Azure option — users hit "Custom endpoint" and still get auth wrong | `wiki.ts:151-156` |
| 6 | Azure content-filter 400 errors are swallowed as generic "API error" — no actionable message | `wiki.ts:305-329` |
| 7 | `finish_reason: "content_filter"` in streaming chunks is silently ignored | `llm-client.ts:164-205` |

---

## File Map

| File | Change |
|------|--------|
| `gitnexus/src/storage/repo-manager.ts` | Add `provider` and `apiVersion` fields to `CLIConfig` interface |
| `gitnexus/src/core/wiki/llm-client.ts` | Fix auth header, add api-version, add reasoning model param stripping, handle content_filter in stream |
| `gitnexus/src/cli/wiki.ts` | Add Azure option to interactive setup wizard, handle content_filter errors |
| `gitnexus/test/unit/wiki-llm-client.test.ts` | New test file for all llm-client logic |

---

## Task 1: Extend Config Types

**Files:**
- Modify: `gitnexus/src/storage/repo-manager.ts:321-325`

- [ ] **Step 1: Write the failing test**

Create `gitnexus/test/unit/wiki-llm-client.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd gitnexus && npx vitest run test/unit/wiki-llm-client.test.ts
```

Expected: FAIL — `isAzureProvider`, `isReasoningModel`, `buildRequestUrl` not exported

- [ ] **Step 3: Update `CLIConfig` interface in `repo-manager.ts`**

In `gitnexus/src/storage/repo-manager.ts`, replace lines 321–325:

```typescript
// Before:
export interface CLIConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

// After:
export interface CLIConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  /** Provider type — controls auth header and URL construction */
  provider?: 'openai' | 'openrouter' | 'azure' | 'custom';
  /** Azure api-version query param (e.g. '2024-10-21'). Only used when provider is 'azure'. */
  apiVersion?: string;
  /** Set true when the deployment is a reasoning model (o1, o3, o4-mini). Auto-detected for OpenAI; must be set for Azure deployments. */
  isReasoningModel?: boolean;
}
```

- [ ] **Step 4: Update `LLMConfig` interface in `llm-client.ts`**

In `gitnexus/src/core/wiki/llm-client.ts`, replace the `LLMConfig` interface:

```typescript
export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  temperature: number;
  /** Provider type — controls auth header behaviour */
  provider?: 'openai' | 'openrouter' | 'azure' | 'custom';
  /** Azure api-version query param (e.g. '2024-10-21'). Appended to URL when set. */
  apiVersion?: string;
  /** When true, strips sampling params and uses max_completion_tokens instead of max_tokens */
  isReasoningModel?: boolean;
}
```

- [ ] **Step 5: Update `resolveLLMConfig` to pass through new fields**

In `gitnexus/src/core/wiki/llm-client.ts`, replace the `resolveLLMConfig` function body:

```typescript
export async function resolveLLMConfig(overrides?: Partial<LLMConfig>): Promise<LLMConfig> {
  const { loadCLIConfig } = await import('../../storage/repo-manager.js');
  const savedConfig = await loadCLIConfig();

  const apiKey = overrides?.apiKey
    || process.env.GITNEXUS_API_KEY
    || process.env.OPENAI_API_KEY
    || savedConfig.apiKey
    || '';

  return {
    apiKey,
    baseUrl: overrides?.baseUrl
      || process.env.GITNEXUS_LLM_BASE_URL
      || savedConfig.baseUrl
      || 'https://openrouter.ai/api/v1',
    model: overrides?.model
      || process.env.GITNEXUS_MODEL
      || savedConfig.model
      || 'minimax/minimax-m2.5',
    maxTokens: overrides?.maxTokens ?? 16_384,
    temperature: overrides?.temperature ?? 0,
    provider: overrides?.provider ?? savedConfig.provider,
    apiVersion: overrides?.apiVersion
      || process.env.GITNEXUS_AZURE_API_VERSION
      || savedConfig.apiVersion,
    isReasoningModel: overrides?.isReasoningModel ?? savedConfig.isReasoningModel,
  };
}
```

- [ ] **Step 6: Add helper functions to `llm-client.ts` (before `callLLM`)**

Add these three exported functions after `estimateTokens`:

```typescript
/**
 * Returns true if the given base URL is an Azure OpenAI endpoint.
 */
export function isAzureProvider(baseUrl: string): boolean {
  return baseUrl.includes('.openai.azure.com') || baseUrl.includes('.services.ai.azure.com');
}

/**
 * Returns true if the model name matches a known reasoning model pattern,
 * or if the explicit override is true.
 * Pass override=false to force non-reasoning even for o-series names.
 */
export function isReasoningModel(model: string, override?: boolean): boolean {
  if (override !== undefined) return override;
  return /^o[1-9](-mini|-preview)?$|^o[1-9]$|^o\d+-mini$/i.test(model);
}

/**
 * Build the full chat completions URL, appending ?api-version when provided.
 */
export function buildRequestUrl(baseUrl: string, apiVersion: string | undefined): string {
  const base = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return apiVersion ? `${base}?api-version=${apiVersion}` : base;
}
```

- [ ] **Step 7: Run tests to verify helpers pass**

```bash
cd gitnexus && npx vitest run test/unit/wiki-llm-client.test.ts
```

Expected: `isAzureProvider`, `isReasoningModel`, `buildRequestUrl` tests pass (12 tests)

- [ ] **Step 8: Commit**

```bash
git add gitnexus/src/storage/repo-manager.ts gitnexus/src/core/wiki/llm-client.ts gitnexus/test/unit/wiki-llm-client.test.ts
git commit -m "feat(wiki): extend LLMConfig/CLIConfig with Azure and reasoning model fields"
```

---

## Task 2: Fix Auth Header and API-Version in `callLLM`

**Files:**
- Modify: `gitnexus/src/core/wiki/llm-client.ts` (the `callLLM` function)

- [ ] **Step 1: Write the failing tests**

Add to `gitnexus/test/unit/wiki-llm-client.test.ts`:

```typescript
import { vi } from 'vitest';

describe('callLLM — auth header', () => {
  it('uses Authorization: Bearer for non-Azure endpoints', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: 'hello' } }], usage: {} }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));
    vi.stubGlobal('fetch', fetchSpy);

    const { callLLM } = await import('../../src/core/wiki/llm-client.js');
    await callLLM('test', {
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      maxTokens: 100,
      temperature: 0,
    });

    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers['Authorization']).toBe('Bearer sk-test');
    expect(init.headers['api-key']).toBeUndefined();

    vi.unstubAllGlobals();
  });

  it('uses api-key header for Azure endpoints', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: 'hello' } }], usage: {} }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));
    vi.stubGlobal('fetch', fetchSpy);

    const { callLLM } = await import('../../src/core/wiki/llm-client.js');
    await callLLM('test', {
      apiKey: 'azure-key-123',
      baseUrl: 'https://myres.openai.azure.com/openai/deployments/my-dep',
      model: 'my-dep',
      maxTokens: 100,
      temperature: 0,
      provider: 'azure',
      apiVersion: '2024-10-21',
    });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('?api-version=2024-10-21');
    expect(init.headers['api-key']).toBe('azure-key-123');
    expect(init.headers['Authorization']).toBeUndefined();

    vi.unstubAllGlobals();
  });
});

describe('callLLM — reasoning model params', () => {
  it('uses max_completion_tokens and strips temperature for reasoning models', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: 'answer' } }], usage: {} }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));
    vi.stubGlobal('fetch', fetchSpy);

    const { callLLM } = await import('../../src/core/wiki/llm-client.js');
    await callLLM('test', {
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'o3-mini',
      maxTokens: 500,
      temperature: 0,
    });

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.max_completion_tokens).toBe(500);
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();

    vi.unstubAllGlobals();
  });

  it('uses max_tokens and temperature for non-reasoning models', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: 'answer' } }], usage: {} }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));
    vi.stubGlobal('fetch', fetchSpy);

    const { callLLM } = await import('../../src/core/wiki/llm-client.js');
    await callLLM('test', {
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      maxTokens: 500,
      temperature: 0.5,
    });

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.max_tokens).toBe(500);
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.temperature).toBe(0.5);

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd gitnexus && npx vitest run test/unit/wiki-llm-client.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: FAIL — auth header tests fail (still using `Authorization: Bearer`), reasoning model tests fail (`max_tokens` always set)

- [ ] **Step 3: Rewrite `callLLM` in `llm-client.ts`**

Replace the entire `callLLM` function:

```typescript
export async function callLLM(
  prompt: string,
  config: LLMConfig,
  systemPrompt?: string,
  options?: CallLLMOptions,
): Promise<LLMResponse> {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  // Detect whether this is an Azure endpoint (by provider field or URL pattern)
  const azure = config.provider === 'azure' || isAzureProvider(config.baseUrl);

  // Detect reasoning model (o1, o3, o4-mini etc.)
  const reasoning = isReasoningModel(config.model, config.isReasoningModel);

  const url = buildRequestUrl(config.baseUrl, azure ? config.apiVersion : undefined);
  const useStream = !!options?.onChunk;

  // Build request body — reasoning models reject temperature and use max_completion_tokens
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
  };

  if (reasoning) {
    body.max_completion_tokens = config.maxTokens;
    // Do NOT include temperature, top_p, presence_penalty, frequency_penalty
  } else {
    body.max_tokens = config.maxTokens;
    body.temperature = config.temperature;
  }

  if (useStream) body.stream = true;

  // Build auth headers — Azure uses api-key, everyone else uses Authorization: Bearer
  const authHeaders: Record<string, string> = azure
    ? { 'api-key': config.apiKey }
    : { 'Authorization': `Bearer ${config.apiKey}` };

  const MAX_RETRIES = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'unknown error');

        // Azure content filter — surface a clear message
        if (response.status === 400 && errorText.includes('content_filter')) {
          throw new Error(`Azure content filter blocked this request. The prompt triggered content policy. Details: ${errorText.slice(0, 300)}`);
        }

        // Rate limit — wait with exponential backoff and retry
        if (response.status === 429 && attempt < MAX_RETRIES - 1) {
          const retryAfter = parseInt(response.headers.get('retry-after') || '0', 10);
          const delay = retryAfter > 0 ? retryAfter * 1000 : (2 ** attempt) * 3000;
          await sleep(delay);
          continue;
        }

        // Server error — retry with backoff
        if (response.status >= 500 && attempt < MAX_RETRIES - 1) {
          await sleep((attempt + 1) * 2000);
          continue;
        }

        throw new Error(`LLM API error (${response.status}): ${errorText.slice(0, 500)}`);
      }

      // Streaming path
      if (useStream && response.body) {
        return await readSSEStream(response.body, options!.onChunk!);
      }

      // Non-streaming path
      const json = await response.json() as any;
      const choice = json.choices?.[0];
      if (!choice?.message?.content) {
        throw new Error('LLM returned empty response');
      }

      return {
        content: choice.message.content,
        promptTokens: json.usage?.prompt_tokens,
        completionTokens: json.usage?.completion_tokens,
      };
    } catch (err: any) {
      lastError = err;

      // Network error — retry with backoff
      if (attempt < MAX_RETRIES - 1 && (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.message?.includes('fetch'))) {
        await sleep((attempt + 1) * 3000);
        continue;
      }

      throw err;
    }
  }

  throw lastError || new Error('LLM call failed after retries');
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd gitnexus && npx vitest run test/unit/wiki-llm-client.test.ts --reporter=verbose
```

Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add gitnexus/src/core/wiki/llm-client.ts gitnexus/test/unit/wiki-llm-client.test.ts
git commit -m "fix(wiki): fix Azure auth header, api-version param, and reasoning model params"
```

---

## Task 3: Handle `content_filter` in SSE Streaming

**Files:**
- Modify: `gitnexus/src/core/wiki/llm-client.ts` (the `readSSEStream` function)

- [ ] **Step 1: Write the failing test**

Add to `gitnexus/test/unit/wiki-llm-client.test.ts`:

```typescript
describe('readSSEStream — content_filter handling', () => {
  it('throws a clear error when finish_reason is content_filter', async () => {
    // Simulate an SSE stream where the last chunk has finish_reason: content_filter
    const streamContent = [
      'data: {"choices":[{"delta":{"content":"partial "},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"content_filter","content_filter_results":{"violence":{"filtered":true,"severity":"medium"}}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(streamContent));
        controller.close();
      },
    });

    // Access the private function via module internals by testing callLLM with a mock
    const fetchSpy = vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const { callLLM } = await import('../../src/core/wiki/llm-client.js');

    await expect(callLLM('test', {
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      maxTokens: 100,
      temperature: 0,
    }, undefined, { onChunk: () => {} })).rejects.toThrow('content filter');

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd gitnexus && npx vitest run test/unit/wiki-llm-client.test.ts -t "content_filter"
```

Expected: FAIL — currently `readSSEStream` ignores `finish_reason`, returns partial content instead of throwing

- [ ] **Step 3: Update `readSSEStream` to detect `content_filter` finish reason**

Replace the `readSSEStream` function in `llm-client.ts`:

```typescript
async function readSSEStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (charsReceived: number) => void,
): Promise<LLMResponse> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let content = '';
  let buffer = '';
  let contentFilterTriggered = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const choice = parsed.choices?.[0];

        // Detect Azure content filter finish reason
        if (choice?.finish_reason === 'content_filter') {
          contentFilterTriggered = true;
        }

        const delta = choice?.delta?.content;
        if (delta) {
          content += delta;
          onChunk(content.length);
        }
      } catch {
        // Skip malformed SSE chunks
      }
    }
  }

  if (contentFilterTriggered) {
    throw new Error('Azure content filter blocked the response mid-stream. The generated content triggered content policy. Adjust your prompt and retry.');
  }

  if (!content) {
    throw new Error('LLM returned empty streaming response');
  }

  return { content };
}
```

- [ ] **Step 4: Run all tests to verify they pass**

```bash
cd gitnexus && npx vitest run test/unit/wiki-llm-client.test.ts --reporter=verbose
```

Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add gitnexus/src/core/wiki/llm-client.ts gitnexus/test/unit/wiki-llm-client.test.ts
git commit -m "fix(wiki): detect content_filter finish_reason in SSE stream and throw clear error"
```

---

## Task 4: Add Azure Option to Interactive Setup Wizard

**Files:**
- Modify: `gitnexus/src/cli/wiki.ts` (the interactive setup section, lines 138–209)

This task has no unit tests (pure I/O flow) — verify manually after implementation.

- [ ] **Step 1: Replace the interactive provider selection block in `wiki.ts`**

Find the block starting at `console.log('  Supports OpenAI, OpenRouter, or any OpenAI-compatible API.\n');` (around line 151) and replace through to the closing of the `else` block (`baseUrl = 'https://api.openai.com/v1'; defaultModel = 'gpt-4o-mini';`) at approximately line 176:

```typescript
      console.log('  Supports OpenAI, OpenRouter, Azure, or any OpenAI-compatible API.\n');

      // Provider selection
      console.log('  [1] OpenAI (api.openai.com)');
      console.log('  [2] OpenRouter (openrouter.ai)');
      console.log('  [3] Azure OpenAI');
      console.log('  [4] Custom endpoint\n');

      const choice = await prompt('  Select provider (1/2/3/4): ');

      let baseUrl: string;
      let defaultModel: string;
      let providerType: 'openai' | 'openrouter' | 'azure' | 'custom';
      let apiVersion: string | undefined;
      let isReasoningModelDeployment: boolean | undefined;

      if (choice === '2') {
        baseUrl = 'https://openrouter.ai/api/v1';
        defaultModel = 'minimax/minimax-m2.5';
        providerType = 'openrouter';
      } else if (choice === '3') {
        // Azure OpenAI guided setup
        console.log('\n  Azure OpenAI setup.');
        console.log('  You need: your resource name, deployment name, and API key from the Azure portal.\n');

        const resourceName = await prompt('  Azure resource name (e.g. my-openai-resource): ');
        if (!resourceName) {
          console.log('\n  No resource name provided. Aborting.\n');
          process.exitCode = 1;
          return;
        }

        const deploymentName = await prompt('  Deployment name (the name you gave your model deployment): ');
        if (!deploymentName) {
          console.log('\n  No deployment name provided. Aborting.\n');
          process.exitCode = 1;
          return;
        }

        // Offer v1 or legacy URL
        console.log('\n  API format:');
        console.log('  [1] v1 API — recommended (no api-version needed)');
        console.log('  [2] Legacy — uses api-version query param\n');
        const apiFormat = await prompt('  Select format (1/2, default: 1): ');

        if (apiFormat === '2') {
          const versionInput = await prompt('  api-version (default: 2024-10-21): ');
          apiVersion = versionInput || '2024-10-21';
          baseUrl = `https://${resourceName}.openai.azure.com/openai/deployments/${deploymentName}`;
        } else {
          baseUrl = `https://${resourceName}.openai.azure.com/openai/v1`;
          apiVersion = undefined;
        }

        defaultModel = deploymentName;
        providerType = 'azure';

        // Ask if this is a reasoning model deployment (can't auto-detect from deployment name)
        const reasoningAnswer = await prompt('  Is this a reasoning model (o1, o3, o4-mini)? (y/N): ');
        isReasoningModelDeployment = reasoningAnswer.toLowerCase() === 'y' || reasoningAnswer.toLowerCase() === 'yes'
          ? true
          : undefined;

        if (isReasoningModelDeployment) {
          console.log('  Note: temperature and max_tokens will be omitted for this deployment (Azure requirement).');
        }
      } else if (choice === '4') {
        baseUrl = await prompt('  Base URL (e.g. http://localhost:11434/v1): ');
        if (!baseUrl) {
          console.log('\n  No URL provided. Aborting.\n');
          process.exitCode = 1;
          return;
        }
        defaultModel = 'gpt-4o-mini';
        providerType = 'custom';
      } else {
        baseUrl = 'https://api.openai.com/v1';
        defaultModel = 'gpt-4o-mini';
        providerType = 'openai';
      }
```

- [ ] **Step 2: Update the model prompt section (immediately after the block above)**

Replace the `const modelInput = await prompt(...)` line and the key collection code through `await saveCLIConfig({ apiKey: key, baseUrl, model });`:

```typescript
      // Model — for Azure, the default is the deployment name already set
      const modelInput = await prompt(`  Model / deployment name (default: ${defaultModel}): `);
      const model = modelInput || defaultModel;

      // API key — pre-fill hint if env var exists
      const envKey = process.env.GITNEXUS_API_KEY || process.env.OPENAI_API_KEY || '';
      let key: string;
      if (envKey) {
        const masked = envKey.slice(0, 6) + '...' + envKey.slice(-4);
        const useEnv = await prompt(`  Use existing env key (${masked})? (Y/n): `);
        if (!useEnv || useEnv.toLowerCase() === 'y' || useEnv.toLowerCase() === 'yes') {
          key = envKey;
        } else {
          key = await prompt('  API key: ', true);
        }
      } else {
        key = await prompt('  API key: ', true);
      }

      if (!key) {
        console.log('\n  No key provided. Aborting.\n');
        process.exitCode = 1;
        return;
      }

      // Save — include Azure-specific fields
      const configToSave: Parameters<typeof saveCLIConfig>[0] = { apiKey: key, baseUrl, model, provider: providerType };
      if (apiVersion) configToSave.apiVersion = apiVersion;
      if (isReasoningModelDeployment !== undefined) configToSave.isReasoningModel = isReasoningModelDeployment;
      await saveCLIConfig(configToSave);
      console.log('  Config saved to ~/.gitnexus/config.json\n');

      llmConfig = { ...llmConfig, apiKey: key, baseUrl, model, provider: providerType, apiVersion, isReasoningModel: isReasoningModelDeployment };
```

- [ ] **Step 3: Update the content-filter error handler in `wiki.ts`**

Find the `catch (err: any)` block starting around line 299. Add handling for content filter errors (insert before the `else if (err.message?.includes('API key')` check):

```typescript
    } catch (err: any) {
      clearInterval(elapsedTimer);
      bar.stop();

      if (err.message?.includes('No source files')) {
        console.log(`\n  ${err.message}\n`);
      } else if (err.message?.includes('content filter')) {
        // Azure content policy block — actionable message
        console.log(`\n  Azure Content Filter: ${err.message}\n`);
        console.log('  To resolve: rephrase your prompt or adjust the content filter policy for your Azure deployment in the Azure portal.\n');
      } else if (err.message?.includes('API key') || err.message?.includes('API error')) {
        // ... (existing auth error handling unchanged)
```

- [ ] **Step 4: Type-check**

```bash
cd gitnexus && npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors. Fix any type errors before continuing.

- [ ] **Step 5: Commit**

```bash
git add gitnexus/src/cli/wiki.ts
git commit -m "feat(wiki): add Azure OpenAI option to interactive setup wizard"
```

---

## Task 5: Update CLI Help Text

**Files:**
- Modify: `gitnexus/src/cli/index.ts:66-74`

- [ ] **Step 1: Update the `wiki` command option descriptions**

In `gitnexus/src/cli/index.ts`, replace the wiki command block:

```typescript
program
  .command('wiki [path]')
  .description('Generate repository wiki from knowledge graph')
  .option('-f, --force', 'Force full regeneration even if up to date')
  .option('--model <model>', 'LLM model or Azure deployment name (default: minimax/minimax-m2.5)')
  .option('--base-url <url>', 'LLM API base URL. Azure v1: https://{resource}.openai.azure.com/openai/v1')
  .option('--api-key <key>', 'LLM API key or Azure api-key (saved to ~/.gitnexus/config.json)')
  .option('--api-version <version>', 'Azure api-version query param (e.g. 2024-10-21, for legacy Azure API only)')
  .option('--reasoning-model', 'Mark model as a reasoning model (o1/o3/o4-mini) — strips temperature, uses max_completion_tokens')
  .option('--concurrency <n>', 'Parallel LLM calls (default: 3)', '3')
  .option('--gist', 'Publish wiki as a public GitHub Gist after generation')
  .action(createLazyAction(() => import('./wiki.js'), 'wikiCommand'));
```

- [ ] **Step 2: Wire `--api-version` and `--reasoning-model` flags into `WikiCommandOptions`**

In `gitnexus/src/cli/wiki.ts`, update the `WikiCommandOptions` interface:

```typescript
export interface WikiCommandOptions {
  force?: boolean;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  apiVersion?: string;
  reasoningModel?: boolean;
  concurrency?: string;
  gist?: boolean;
}
```

- [ ] **Step 3: Wire new flags into config saving and `resolveLLMConfig` call in `wikiCommand`**

Find the block that saves CLI overrides (around line 116):

```typescript
  if (options?.apiKey || options?.model || options?.baseUrl) {
    const existing = await loadCLIConfig();
    const updates: Record<string, string> = {};
    if (options.apiKey) updates.apiKey = options.apiKey;
    if (options.model) updates.model = options.model;
    if (options.baseUrl) updates.baseUrl = options.baseUrl;
    await saveCLIConfig({ ...existing, ...updates });
    console.log('  Config saved to ~/.gitnexus/config.json\n');
  }
```

Replace with:

```typescript
  if (options?.apiKey || options?.model || options?.baseUrl || options?.apiVersion || options?.reasoningModel !== undefined) {
    const existing = await loadCLIConfig();
    const updates: Partial<typeof existing> = {};
    if (options.apiKey) updates.apiKey = options.apiKey;
    if (options.model) updates.model = options.model;
    if (options.baseUrl) updates.baseUrl = options.baseUrl;
    if (options.apiVersion) updates.apiVersion = options.apiVersion;
    if (options.reasoningModel !== undefined) updates.isReasoningModel = options.reasoningModel;
    await saveCLIConfig({ ...existing, ...updates });
    console.log('  Config saved to ~/.gitnexus/config.json\n');
  }
```

And update the `resolveLLMConfig` call:

```typescript
  let llmConfig = await resolveLLMConfig({
    model: options?.model,
    baseUrl: options?.baseUrl,
    apiKey: options?.apiKey,
    apiVersion: options?.apiVersion,
    isReasoningModel: options?.reasoningModel,
  });
```

- [ ] **Step 4: Type-check**

```bash
cd gitnexus && npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 5: Run full unit test suite**

```bash
cd gitnexus && npx vitest run test/unit/wiki-llm-client.test.ts --reporter=verbose
```

Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add gitnexus/src/cli/index.ts gitnexus/src/cli/wiki.ts
git commit -m "feat(wiki): add --api-version and --reasoning-model CLI flags for Azure"
```

---

## Self-Review Checklist

| Requirement | Covered by |
|-------------|-----------|
| Azure `api-key` header | Task 2, Step 3 |
| `api-version` query param | Task 1 (`buildRequestUrl`), Task 2 |
| Reasoning model: strip `temperature` | Task 2, Step 3 |
| Reasoning model: `max_completion_tokens` not `max_tokens` | Task 2, Step 3 |
| `CLIConfig` schema additions | Task 1, Step 3 |
| Interactive setup Azure option | Task 4 |
| `content_filter` 400 error message | Task 2, Step 3 |
| `finish_reason: content_filter` in stream | Task 3 |
| `--api-version` CLI flag | Task 5 |
| `--reasoning-model` CLI flag | Task 5 |
| Azure auto-detection from URL | Task 1, Step 6 (`isAzureProvider`) |
| Tests for all logic | Tasks 1-3 |

**Known limitations not addressed (out of scope):**
- Azure Entra ID / bearer token auth (requires token refresh logic — separate feature)
- Azure Foundry non-OpenAI models (DeepSeek, Llama etc.) — work via custom endpoint already
- `stream_options` + `data_sources` conflict — not used in this codebase
- Async filter annotation chunks in stream — safely ignored (no semantic impact, extra chunks with no `delta.content` are already skipped)
