import { Context } from 'hono';
import { stream as honoStream } from 'hono/streaming';
import { getClaudeHeaders } from '../services/playwright.js';

export async function chatCompletions(c: Context) {
  try {
    const body = await c.req.json();
    const { messages, model = 'claude-sonnet-4-5', stream = false } = body;

    if (!messages || !Array.isArray(messages)) {
      return c.json({ error: { message: 'messages array is required' } }, 400);
    }

    const lastMessage = messages[messages.length - 1];
    const userContent = lastMessage?.content || '';

    console.log(`[ClaudeProxy] Chat request with model: ${model}`);
    console.log(`[ClaudeProxy] Last message: ${userContent.substring(0, 100)}...`);

    const { headers } = await getClaudeHeaders();

    const systemMessages: string[] = [];
    const anthropicMessages: any[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        const content = typeof msg.content === 'string' ? msg.content : msg.content?.text || '';
        systemMessages.push(content);
      } else {
        anthropicMessages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: typeof msg.content === 'string' ? msg.content : msg.content?.text || ''
        });
      }
    }

    const requestBody: any = {
      model: mapModel(model),
      messages: anthropicMessages,
      max_tokens: body.max_tokens || 4096,
      stream: stream
    };

    if (systemMessages.length > 0) {
      requestBody.system = systemMessages.join('\n\n');
    }

    const response = await fetch('https://claude.ai/api/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': headers['cookie'] || '',
        'anthropic-sentiment-account-id': headers['anthropic-sentiment-account-id'] || '',
        'x-anthropic-account': headers['x-anthropic-account'] || '',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ClaudeProxy] Claude API error: ${response.status} - ${errorText}`);
      return c.json({ error: { message: `Claude API error: ${response.status}`, details: errorText } }, response.status as any);
    }

    const completionId = `chatcmpl-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    if (stream) {
      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache');
      c.header('Connection', 'keep-alive');

      return honoStream(c, async (streamWriter: any) => {
        try {
          const writeEvent = async (data: any) => {
            await streamWriter.write(`data: ${JSON.stringify(data)}\n\n`);
          };

          const makeChoice = (delta: any, finishReason: string | null = null) => ({
            index: 0,
            delta,
            logprobs: null,
            finish_reason: finishReason
          });

          await writeEvent({
            id: completionId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [makeChoice({ role: 'assistant', content: '' })]
          });

          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('No response body');
          }

          const decoder = new TextDecoder();
          let buffer = '';
          let completionTokens = 0;
          let fullContent = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;

              const dataStr = trimmed.slice(6);
              if (dataStr === '[DONE]') {
                await writeEvent({
                  id: completionId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [makeChoice({}, 'stop')],
                  usage: {
                    prompt_tokens: 0,
                    completion_tokens: completionTokens,
                    total_tokens: completionTokens
                  }
                });
                await streamWriter.write('data: [DONE]\n\n');
                continue;
              }

              try {
                const chunk = JSON.parse(dataStr);

                if (chunk.type === 'message_start' && chunk.message?.usage) {
                  // nothing needed here yet
                } else if (chunk.type === 'content_block_delta') {
                  const delta = chunk.delta;
                  if (delta?.type === 'text_delta' && delta.text) {
                    fullContent += delta.text;
                    completionTokens++;
                    await writeEvent({
                      id: completionId,
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model,
                      choices: [makeChoice({ content: delta.text })]
                    });
                  }
                } else if (chunk.type === 'message_delta' && chunk.usage) {
                  if (chunk.usage.output_tokens) completionTokens = chunk.usage.output_tokens;
                }
              } catch (e) {
                // ignore parse errors on partial chunks
              }
            }
          }
        } finally {
          // stream cleanup
        }
      });
    }

    const data = await response.json();
    const content = data.content?.[0]?.text || '';

    return c.json({
      id: completionId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: data.usage?.input_tokens || 0,
        completion_tokens: data.usage?.output_tokens || 0,
        total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
      }
    });

  } catch (err: any) {
    console.error('[ClaudeProxy] Error:', err.message);
    return c.json({ error: { message: err.message } }, 500);
  }
}

function mapModel(model: string): string {
  const modelMap: Record<string, string> = {
    'claude-sonnet-4-5-20250514': 'claude-sonnet-4-5-20250514',
    'claude-opus-4-20250514': 'claude-opus-4-20250514',
    'claude-3-7-sonnet-20250219': 'claude-3-7-sonnet-20250219',
    'claude-3-5-sonnet-20241022': 'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022': 'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229': 'claude-3-opus-20240229',
    'claude-3-sonnet-20240229': 'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307': 'claude-3-haiku-20240307',
    'claude-sonnet-4-5': 'claude-sonnet-4-5-20250514',
    'claude-opus-4': 'claude-opus-4-20250514',
    'claude-3-7-sonnet': 'claude-3-7-sonnet-20250219',
    'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku': 'claude-3-5-haiku-20241022',
    'claude-3-opus': 'claude-3-opus-20240229',
    'claude-3-sonnet': 'claude-3-sonnet-20240229',
    'claude-3-haiku': 'claude-3-haiku-20240307'
  };

  const normalized = model.toLowerCase().replace(/\s+/g, '-');
  return modelMap[normalized] || 'claude-sonnet-4-5-20250514';
}

export async function fetchClaudeModels() {
  return [
    { id: 'claude-sonnet-4-5-20250514', object: 'model', created: 1747200000, owned_by: 'anthropic' },
    { id: 'claude-opus-4-20250514', object: 'model', created: 1747200000, owned_by: 'anthropic' },
    { id: 'claude-3-7-sonnet-20250219', object: 'model', created: 1739904000, owned_by: 'anthropic' },
    { id: 'claude-3-5-sonnet-20241022', object: 'model', created: 1729555200, owned_by: 'anthropic' },
    { id: 'claude-3-5-haiku-20241022', object: 'model', created: 1729555200, owned_by: 'anthropic' },
    { id: 'claude-3-opus-20240229', object: 'model', created: 1709164800, owned_by: 'anthropic' },
    { id: 'claude-3-sonnet-20240229', object: 'model', created: 1709164800, owned_by: 'anthropic' },
    { id: 'claude-3-haiku-20240307', object: 'model', created: 1709769600, owned_by: 'anthropic' }
  ];
}