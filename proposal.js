import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(resolve(__dirname, 'prompts', 'proposal.md'), 'utf-8');

let client;
function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export async function generateProposal({ lead, companyType, websiteUrl }) {
  const userMessage = [
    `Company: ${lead.company || 'Unknown'}`,
    `Contact: ${[lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unknown'}, ${lead.jobTitle || 'Unknown'}`,
    `Company type: ${companyType || 'Unknown'}`,
    `Country: ${lead.country || 'Unknown'}`,
    `Employee count: ${lead.employeeCount || 'Unknown'}`,
    `Industry: ${lead.industry || 'Unknown'}`,
    websiteUrl ? `Company website URL: ${websiteUrl}` : '(no website URL available — infer from company type and contact title)',
  ].join('\n');

  const tools = [{ type: 'web_fetch_20260209', name: 'web_fetch', allowed_callers: ['direct'] }];
  let messages = [{ role: 'user', content: userMessage }];
  let response;
  let continuations = 0;

  do {
    response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
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
  if (!textBlock) throw new Error(`Proposal generation returned no text block; stop_reason=${response.stop_reason}`);

  return textBlock.text.trim();
}
