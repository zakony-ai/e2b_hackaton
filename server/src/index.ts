// Load environment variables from .env file (for local development only)
// In E2B sandbox, GROQ_API_KEY is passed via command line
// Only load dotenv if we're in local dev (not in E2B sandbox)
if (process.env.NODE_ENV !== 'production') {
  try {
    await import('dotenv/config');
  } catch {
    // dotenv not available or failed to load - that's ok in sandbox
  }
}

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { streamSSE } from 'hono/streaming';
import { cors } from 'hono/cors';
import OpenAI from 'openai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { log } from './logger';

const app = new Hono();

// Enable CORS for all routes
app.use('*', cors({
  origin: '*', // Allow all origins for E2B sandbox access
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}));

// Server state
let agentStream: AsyncIterable<unknown> | null = null;
const sseConnections: Set<WritableStreamDefaultWriter> = new Set();

// Helper to check if agent is talking
function isAgentTalking(): boolean {
  return agentStream !== null;
}

// Helper to append message to NDJSON file
async function appendMessageToFile(message: { role: string; content: string }): Promise<void> {
  const messagesPath = path.join(process.cwd(), 'messages.ndjson');
  const line = JSON.stringify(message) + '\n';
  await fs.appendFile(messagesPath, line, 'utf-8');
}

// Helper to read all messages from NDJSON file
async function readMessagesFromFile(): Promise<Array<{ role: string; content: string }>> {
  const messagesPath = path.join(process.cwd(), 'messages.ndjson');
  try {
    const fileContent = await fs.readFile(messagesPath, 'utf-8');
    return fileContent
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
  } catch {
    // File doesn't exist yet or is empty
    return [];
  }
}

app.get('/healthcheck', (c) => {
  log({ level: 'info', message: 'Healthcheck request' });
  return c.json({ status: 'ok', message: 'Server is up and running' });
});

app.post('/agent/talk', async (c) => {
  log({ level: 'info', message: 'Agent talk request received' });

  if (isAgentTalking()) {
    log({ level: 'warn', message: 'Agent is already talking' });
    return c.json(
      { error: 'Agent is already talking. Use /agent/sorryiwasntlistening to reconnect.' },
      { status: 409 }
    );
  }

  const { user_prompt } = await c.req.json();

  if (!user_prompt) {
    log({ level: 'error', message: 'Missing user_prompt' });
    return c.json({ error: 'user_prompt is required' }, { status: 400 });
  }

  log({ level: 'info', message: 'Processing user prompt', promptLength: user_prompt.length });

  // Save user message
  await appendMessageToFile({ role: 'user', content: user_prompt });

  // Read all messages for context
  const messages = await readMessagesFromFile();

  // Initialize OpenAI client (using Groq endpoint)
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    log({ level: 'error', message: 'GROQ_API_KEY not configured' });
    return c.json({ error: 'GROQ_API_KEY not configured' }, { status: 500 });
  }

  const client = new OpenAI({
    apiKey: groqApiKey,
    baseURL: 'https://api.groq.com/openai/v1',
  });

  log({ level: 'info', message: 'Starting Groq stream', model: 'moonshotai/kimi-k2-instruct-0905', messageCount: messages.length });

  // Start streaming response from Groq
  const stream = await client.chat.completions.create({
    model: 'moonshotai/kimi-k2-instruct-0905',
    messages: messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    stream: true,
  });

  agentStream = stream as unknown as AsyncIterable<unknown>;

  // Stream SSE to client
  return streamSSE(c, async (sseStream) => {
    let fullMessage = '';

    try {
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          fullMessage += delta;
          // Send delta to client
          await sseStream.writeSSE({
            data: JSON.stringify({ type: 'delta', content: delta }),
          });
        }
      }

      // Stream completed - save the full assistant message
      await appendMessageToFile({ role: 'assistant', content: fullMessage });

      log({ level: 'info', message: 'Stream completed', messageLength: fullMessage.length });

      // Send completion event
      await sseStream.writeSSE({
        data: JSON.stringify({ type: 'done' }),
      });

    } catch (error) {
      log({
        level: 'error',
        message: 'Streaming error',
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      });
      await sseStream.writeSSE({
        data: JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : String(error) }),
      });
    } finally {
      // Reset state
      agentStream = null;
    }
  });
});

app.post('/agent/sorryiwasntlistening', async (c) => {
  if (!isAgentTalking()) {
    return c.json(
      { error: 'Agent is not talking. Use /agent/talk to start a conversation.' },
      { status: 400 }
    );
  }

  // Read current messages and return them along with SSE stream
  const messages = await readMessagesFromFile();

  return c.json({
    messages,
    // Note: In a production app, we'd need to handle reconnecting to the active stream
    // For now, this is a simplified version
  });
});

app.post('/agent/stfu', async (c) => {
  log({ level: 'info', message: 'Agent stfu request received' });

  if (!isAgentTalking()) {
    log({ level: 'warn', message: 'Agent is not talking' });
    return c.json(
      { error: 'Agent is not talking.' },
      { status: 400 }
    );
  }

  // Stop the stream
  agentStream = null;

  // Close all SSE connections
  for (const writer of sseConnections) {
    try {
      await writer.close();
    } catch {
      // Ignore errors when closing
    }
  }
  sseConnections.clear();

  log({ level: 'info', message: 'Agent stopped successfully' });

  return c.json({ success: true });
});

const port = parseInt(process.env.PORT || '3001');

log({ level: 'info', message: 'Server starting', port });

serve({
  fetch: app.fetch,
  port,
});

log({ level: 'info', message: 'Server is running', port, url: `http://localhost:${port}` });
