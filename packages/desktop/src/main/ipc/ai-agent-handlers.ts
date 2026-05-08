import { ipcMain, BrowserWindow } from 'electron';
import Anthropic from '@anthropic-ai/sdk';
import { IPC_CHANNELS } from '@rmpg/shared';

// ---------------------------------------------------------------------------
// Agent role system prompts — each role specializes the AI for a specific
// forensic investigation task.
// ---------------------------------------------------------------------------

const ROLE_PROMPTS: Record<string, string> = {
  analyst: `You are an expert digital forensics analyst with deep knowledge of mobile device forensics, file system analysis, and evidence interpretation. You help investigators understand and interpret extracted forensic data.

Your expertise includes:
- Android and iOS file systems and data structures
- SQLite database schema interpretation (WhatsApp, iMessage, contacts, etc.)
- Metadata analysis (EXIF, timestamps, location data)
- Artifact correlation across multiple data sources
- Identifying patterns of behavior from device data

When analyzing data, be precise, objective, and note the forensic significance of findings. Always distinguish between confirmed facts and inferences.`,

  workflow: `You are a digital forensics workflow specialist who guides investigators through evidence collection procedures, ensuring proper methodology and chain of custody.

Your expertise includes:
- Mobile device acquisition workflows (ADB backup, iTunes backup, logical/physical extraction)
- Tool-specific procedures (libimobiledevice, ADB, IPED)
- Common error diagnosis and troubleshooting
- Evidence handling best practices
- Legal admissibility requirements for digital evidence

Provide step-by-step guidance. Flag any actions that could alter evidence or compromise chain of custody. Recommend the least-invasive approach first.`,

  report: `You are a professional forensic report writer who helps investigators produce clear, legally defensible documentation of their findings.

Your expertise includes:
- Forensic report structure and standards
- Technical writing for legal audiences
- Chain of custody documentation
- Converting technical findings into understandable narrative
- Citing artifacts and timestamps precisely

Write in a formal, objective tone. Structure content clearly with sections. Avoid speculation — distinguish clearly between observed facts, reasonable inferences, and unknowns.`,

  custody: `You are a chain of custody and evidence integrity specialist for digital forensics investigations.

Your expertise includes:
- Digital evidence preservation procedures
- Hash verification and integrity documentation
- Evidence handling logs and timestamps
- Legal requirements for digital evidence in various jurisdictions
- Common chain of custody failures and how to prevent them

Emphasize integrity, documentation, and reproducibility. Alert the investigator to any actions that could compromise evidence admissibility.`,
};

// ---------------------------------------------------------------------------

export function registerAiAgentHandlers(): void {
  // ---------------------------------------------------------------------------
  // AI_AGENT_QUERY — synchronous request/response query to Claude
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.AI_AGENT_QUERY,
    async (
      _event,
      payload: {
        apiKey: string;
        role: string;
        messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      }
    ) => {
      const { apiKey, role, messages } = payload;

      if (!apiKey || !apiKey.trim()) {
        throw new Error('No API key provided. Enter your Anthropic API key in the agent settings.');
      }

      const systemPrompt = ROLE_PROMPTS[role] ?? ROLE_PROMPTS['analyst'];

      const client = new Anthropic({ apiKey });

      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: systemPrompt,
        messages,
      });

      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('');

      return { text, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
    }
  );

  // ---------------------------------------------------------------------------
  // AI_AGENT_STREAM — streaming query that pushes chunks via IPC event
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.AI_AGENT_STREAM,
    async (
      event,
      payload: {
        apiKey: string;
        role: string;
        messages: Array<{ role: 'user' | 'assistant'; content: string }>;
        streamId: string;
      }
    ) => {
      const { apiKey, role, messages, streamId } = payload;

      if (!apiKey || !apiKey.trim()) {
        throw new Error('No API key provided.');
      }

      const systemPrompt = ROLE_PROMPTS[role] ?? ROLE_PROMPTS['analyst'];
      const client = new Anthropic({ apiKey });

      const win = BrowserWindow.fromWebContents(event.sender);
      const send = (data: Record<string, unknown>) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.AI_AGENT_STREAM, { streamId, ...data });
        }
      };

      try {
        const stream = await client.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: systemPrompt,
          messages,
        });

        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            send({ type: 'delta', text: chunk.delta.text });
          }
        }

        const finalMessage = await stream.finalMessage();
        send({
          type: 'done',
          inputTokens: finalMessage.usage.input_tokens,
          outputTokens: finalMessage.usage.output_tokens,
        });
      } catch (err) {
        send({ type: 'error', message: (err as Error).message });
      }

      return { started: true };
    }
  );
}
