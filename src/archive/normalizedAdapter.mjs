import { validateConversationRecord } from '../../server/archive/contract.mjs';

/**
 * Provider parser boundary for Archive Model v1.
 *
 * Existing parsers may continue returning their historical shape. Adapters convert
 * those results into the canonical conversation contract before persistence.
 */

function normalizeContent(text) {
  return [
    {
      type: 'text',
      text: typeof text === 'string' ? text : ''
    }
  ];
}

export function createConversationRecord({
  id,
  title,
  platform,
  provider,
  providerConversationId = null,
  messages = [],
  branches = []
}) {
  const record = {
    schemaVersion: 'loominary.conversation/v1',
    conversation: {
      id,
      title: title || 'Untitled conversation',
      platform,
      provider,
      providerConversationId,
      createdAt: null,
      updatedAt: null
    },
    branches,
    messages: messages.map(message => ({
      id: message.id,
      parentId: message.parentId || null,
      branchId: message.branchId || 'main',
      role: message.role || 'unknown',
      createdAt: message.createdAt || null,
      text: message.text || '',
      content: message.content || normalizeContent(message.text),
      attachments: message.attachments || [],
      citations: message.citations || [],
      thinking: message.thinking || null,
      toolCalls: message.toolCalls || []
    }))
  };

  validateConversationRecord(record);
  return record;
}

export const providerAdapters = {
  chatgpt: {
    toArchiveRecord: createConversationRecord
  },
  claude: {
    toArchiveRecord: createConversationRecord
  },
  gemini: {
    toArchiveRecord: createConversationRecord
  },
  grok: {
    toArchiveRecord: createConversationRecord
  }
};
