'use strict';
// Hook for UserPromptSubmit and Stop. Builds a prompt/response log in prompts.txt at the repo root.
//   UserPromptSubmit -> appends the prompt.
//   Stop             -> appends a short summary of the agent's final reply.
const fs = require('fs');
const path = require('path');

const SUMMARY_MAX_CHARS = 600;

// Text of the last assistant message in the transcript JSONL.
function lastAssistantText(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return '';
  const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    let entry;
    try { entry = JSON.parse(lines[i]); } catch { continue; }
    if (entry.type === 'user' && !entry.isMeta && typeof entry.message?.content === 'string') break; // past this turn
    if (entry.type !== 'assistant') continue;
    const content = entry.message?.content;
    const text = Array.isArray(content)
      ? content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
      : (typeof content === 'string' ? content : '');
    if (text.trim()) return text;
  }
  return '';
}

function summarize(text) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > SUMMARY_MAX_CHARS ? `${flat.slice(0, SUMMARY_MAX_CHARS - 1)}…` : flat;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}');
    const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    const stamp = new Date().toISOString();
    let entry = '';

    if (input.hook_event_name === 'Stop') {
      const reply = typeof input.last_assistant_message === 'string' && input.last_assistant_message.trim()
        ? input.last_assistant_message
        : lastAssistantText(input.transcript_path);
      if (!reply) return;
      entry = `[${stamp}] RESPONSE SUMMARY\n${summarize(reply)}\n\n----------------------------------------\n\n`;
    } else {
      const prompt = typeof input.prompt === 'string' ? input.prompt : '';
      if (!prompt) return;
      entry = `[${stamp}] PROMPT\n${prompt}\n\n`;
    }

    fs.appendFileSync(path.join(projectDir, 'prompts.txt'), entry, 'utf8');
  } catch (err) {
    // Never block the session because logging failed.
    process.stderr.write(`log-prompt hook error: ${err.message}\n`);
  }
});
