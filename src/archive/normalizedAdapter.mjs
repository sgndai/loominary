import { validateConversationRecord } from '../../server/archive/contract.mjs';

/**
 * Shared constructor for Archive Model v1 conversation records.
 *
 * Provider-specific adapters are responsible for translating their historical
 * parser output into the fields accepted here.
 */

function normalizeContent(text) {
  return [
    {
      type: 'text',
      text: typeof text === 'string' ? text : ''
    }
  ];
}

function compactOptionalProperties(target, entries) {
  for (const [key, value] of entries) {
    if (value !== undefined) target[key] = value;
  }
  return target;
}

export function createConversationRecord({
  id,
  title,
  platform,
  provider = null,
  providerConversationId = null,
  createdAt = null,
  updatedAt = null,
  favorite,
  metadata,
  messages = [],
  branches = []
}) {
  const conversation = compactOptionalProperties(
    {
      id,
      title: title || 'Untitled conversation',
      platform,
      provider,
      providerConversationId,
      createdAt,
      updatedAt
    },
    [
      ['favorite', favorite],
      ['metadata', metadata]
    ]
  );

  const record = {
    schemaVersion: 'loominary.conversation/v1',
    conversation,
    branches,
    messages: messages.map(message =>
      compactOptionalProperties(
        {
          id: message.id,
          parentId: message.parentId || null,
          branchId: message.branchId || 'main',
          role: message.role || 'unknown',
          createdAt: message.createdAt || null,
          text: typeof message.text === 'string' ? message.text : '',
          content:
            Array.isArray(message.content) && message.content.length > 0
              ? message.content
              : normalizeContent(message.text),
          attachments: Array.isArray(message.attachments) ? message.attachments : [],
          citations: Array.isArray(message.citations) ? message.citations : [],
          thinking: message.thinking ?? null,
          toolCalls: Array.isArray(message.toolCalls) ? message.toolCalls : []
        },
        [['metadata', message.metadata]]
      )
    )
  };

  validateConversationRecord(record);
  return record;
}
