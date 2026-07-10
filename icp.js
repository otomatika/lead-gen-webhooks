import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(resolve(__dirname, 'prompts', 'icp.md'), 'utf-8');

let client;
function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export async function checkICP({ companyName, jobTitle, industry, employeeCount, websiteUrl }) {
  const userMessage = [
    `Company: ${companyName || 'Unknown'}`,
    `Contact job title: ${jobTitle || 'Unknown'}`,
    `Industry: ${industry || 'Unknown'}`,
    `Employee count: ${employeeCount || 'Unknown'}`,
    websiteUrl ? `Company website URL: ${websiteUrl}` : '(no website URL available — assess based on metadata only)',
  ].join('\n');

  const tools = [{ type: 'web_fetch_20260209', name: 'web_fetch', allowed_callers: ['direct'] }];
  let messages = [{ role: 'user', content: userMessage }];
  let response;
  let continuations = 0;

  do {
    response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    if (response.stop_reason === 'pause_turn') {
      messages = [...messages, { role: 'assistant', content: response.content }];
      continuations++;
    }
  } while (response.stop_reason === 'pause_turn' && continuations < 5);

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error(`ICP check returned no text block; stop_reason=${response.stop_reason}`);

  const text = textBlock.text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`ICP check returned non-JSON: ${text}`);

  return JSON.parse(jsonMatch[0]);
}
