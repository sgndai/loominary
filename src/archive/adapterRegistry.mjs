import { chatgptToArchiveRecord } from './chatgptAdapter.mjs';
import { claudeToArchiveRecord } from './claudeAdapter.mjs';
import { geminiToArchiveRecord } from './geminiAdapter.mjs';
import { grokToArchiveRecord } from './grokAdapter.mjs';

const ADAPTERS = {
  chatgpt: chatgptToArchiveRecord,
  claude: claudeToArchiveRecord,
  gemini: geminiToArchiveRecord,
  grok: grokToArchiveRecord
};

const ALIASES = new Map([
  ['chatgpt', 'chatgpt'],
  ['openai', 'chatgpt'],
  ['claude', 'claude'],
  ['claude_code', 'claude'],
  ['anthropic', 'claude'],
  ['gemini', 'gemini'],
  ['gemini_notebooklm', 'gemini'],
  ['notebooklm', 'gemini'],
  ['aistudio', 'gemini'],
  ['google', 'gemini'],
  ['grok', 'grok'],
  ['xai', 'grok']
]);

function firstString(...values) {
  return values.find(value => typeof value === 'string' && value.trim())?.trim().toLowerCase() || null;
}

export function detectProviderAdapter(processedData) {
  if (!processedData || typeof processedData !== 'object' || Array.isArray(processedData)) {
    throw new TypeError('Provider adapter input must be an object');
  }

  const rawData = processedData.raw_data && typeof processedData.raw_data === 'object'
    ? processedData.raw_data
    : {};
  const meta = processedData.meta_info && typeof processedData.meta_info === 'object'
    ? processedData.meta_info
    : {};

  const declared = firstString(
    processedData.format,
    processedData.platform,
    meta.platform,
    rawData.platform,
    meta.provider
  );
  const aliased = declared ? ALIASES.get(declared) : null;
  if (aliased) return aliased;

  if (rawData.mapping && rawData.current_node) return 'chatgpt';
  if (Array.isArray(rawData.chat_messages)) return 'claude';
  if (Array.isArray(rawData.conversation) && rawData.platform) return 'gemini';
  if (Array.isArray(rawData.responses) && (rawData.conversationId || rawData.platform === 'grok')) return 'grok';

  throw new Error(`Unsupported provider format: ${declared || 'unknown'}`);
}

export function adaptProviderConversation(processedData) {
  const provider = detectProviderAdapter(processedData);
  return ADAPTERS[provider](processedData);
}

export function listProviderAdapters() {
  return Object.keys(ADAPTERS);
}
