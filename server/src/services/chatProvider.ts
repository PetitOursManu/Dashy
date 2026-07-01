import Anthropic from '@anthropic-ai/sdk';
import type { ChatProvider } from '../models/ChatConfig.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  provider: ChatProvider;
  model: string;
  apiKey: string;
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
}

/** Raised when the upstream LLM provider fails (bad key, network, quota…). */
export class ProviderError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

/** OpenAI-compatible providers all share the same Chat Completions shape. */
const OPENAI_COMPATIBLE: Record<Exclude<ChatProvider, 'claude'>, string> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  deepseek: 'https://api.deepseek.com/v1',
  // Ollama Cloud exposes an OpenAI-compatible endpoint (Bearer API key).
  ollama: 'https://ollama.com/v1',
};

/** Sensible default model per provider when the admin hasn't picked one. */
export const DEFAULT_MODELS: Record<ChatProvider, string> = {
  openrouter: 'openai/gpt-4o-mini',
  openai: 'gpt-4o-mini',
  deepseek: 'deepseek-chat',
  claude: 'claude-opus-4-8',
  // A widely-available Ollama Cloud model; the admin can override it.
  ollama: 'gpt-oss:120b',
};

/**
 * Send a chat completion to the configured provider and return the assistant's
 * reply text. Claude goes through the official Anthropic SDK; the other three
 * are OpenAI-compatible and use a single `fetch` path.
 */
export async function chatComplete(req: CompletionRequest): Promise<string> {
  const model = req.model || DEFAULT_MODELS[req.provider];
  const maxTokens = req.maxTokens ?? 1024;

  if (req.provider === 'claude') {
    return claudeComplete({ ...req, model, maxTokens });
  }
  return openAiCompatibleComplete({ ...req, model, maxTokens });
}

async function claudeComplete(req: CompletionRequest & { maxTokens: number }): Promise<string> {
  const client = new Anthropic({ apiKey: req.apiKey });
  try {
    const message = await client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    return text || '…';
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      throw new ProviderError(`Claude request failed (${err.status ?? '?'})`);
    }
    throw new ProviderError('Claude request failed');
  }
}

async function openAiCompatibleComplete(
  req: CompletionRequest & { maxTokens: number },
): Promise<string> {
  const baseUrl = OPENAI_COMPATIBLE[req.provider as Exclude<ChatProvider, 'claude'>];
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${req.apiKey}`,
        // OpenRouter recommends identifying the app (optional, harmless elsewhere).
        'HTTP-Referer': 'https://github.com/PetitOursManu/Dashy',
        'X-Title': 'Dashy',
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens,
        messages: [
          { role: 'system', content: req.system },
          ...req.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
    });
  } catch {
    throw new ProviderError('Could not reach the AI provider');
  }

  if (!res.ok) {
    // Surface the upstream reason (bad key, no credits, unknown model…) instead
    // of a bare 502, so the admin's "Test" button is actually diagnostic. We
    // keep our own HTTP status at 502 (Bad Gateway) so a provider 401 can't be
    // mistaken by the client for an expired Dashy session.
    const body = await res.text().catch(() => '');
    let detail = body.slice(0, 300);
    try {
      const parsed = JSON.parse(body) as {
        error?: { message?: string } | string;
        message?: string;
      };
      const fromError =
        typeof parsed.error === 'string' ? parsed.error : parsed.error?.message;
      detail = (fromError ?? parsed.message ?? detail).toString().slice(0, 300);
    } catch {
      /* not JSON — keep the raw snippet */
    }
    throw new ProviderError(
      `AI provider request failed (${res.status})${detail ? `: ${detail}` : ''}`,
    );
  }

  const data = (await res.json().catch(() => null)) as
    | { choices?: { message?: { content?: string } }[] }
    | null;
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new ProviderError('AI provider returned an empty response');
  return text;
}
