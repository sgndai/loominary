import { createConversationRecord } from './normalizedAdapter.mjs';

function mapRole(sender) {
  if (sender === 'human') return 'user';
  if (sender === 'assistant') return 'assistant';
  if (sender === 'tool') return 'tool';
  return 'unknown';
}

function normalizeAttachments(attachments = []) {
  return attachments.map(item => ({
    id: item.id || '',
    name: item.file_name || item.name || 'unknown-file',
    mimeType: item.file_type || item.mimeType || null,
    size: item.file_size || 0,
    source: 'chatgpt',
    location: item.link || null
  }));
}

function normalizeCitations(citations = []) {
  return citations.map(item => ({
    type: item.type || 'unknown',
    url: item.url || item.link || null,
    title: item.title || null,
    matchedText: item.matchedText || item.matched_text || null,
    sourceType: item.sourceType || 'provider'
  }));
}

function normalizeTools(tools = []) {
  return tools.map(tool => ({
    name: tool.name || 'unknown_tool',
    input: tool.input || {},
    result: tool.result || {},
    createdAt: tool.createdAt || null
  }));
}

export function chatgptToArchiveRecord(processedData) {
  const meta = processedData.meta_info || {};

  return createConversationRecord({
    id: meta.uuid || meta.id || `chatgpt-${Date.now()}`,
    title: meta.title,
    platform: 'chatgpt',
    provider: 'openai',
    providerConversationId: meta.uuid || null,
    createdAt: meta.created_at || null,
    updatedAt: meta.updated_at || null,
    messages: (processedData.chat_history || []).map(message => ({
      id: message.uuid,
      parentId: message.parent_uuid || null,
      branchId: message.branch_id || 'main',
      role: mapRole(message.sender),
      createdAt: message.timestamp || null,
      text: message.display_text || message.raw_text || '',
      attachments: normalizeAttachments(message.attachments),
      citations: normalizeCitations(message.citations),
      thinking: message.thinking || null,
      toolCalls: normalizeTools(message.tools)
    })),
    branches: []
  });
}
