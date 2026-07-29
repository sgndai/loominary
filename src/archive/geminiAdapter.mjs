import { createConversationRecord } from './normalizedAdapter.mjs';

const ROOT_UUID = '00000000-0000-4000-8000-000000000000';

const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const firstString = (...values) => values.find(value => typeof value === 'string' && value.length) || null;
const mapRole = sender => sender === 'human' ? 'user' : sender === 'assistant' ? 'assistant' : 'unknown';

function normalizeMessages(data) {
  return (data.chat_history || []).filter(isObject).map((message, index) => ({
    source: message,
    id: firstString(message.uuid) || `gemini-message-${index + 1}`,
    parentId: message.parent_uuid && message.parent_uuid !== ROOT_UUID ? message.parent_uuid : null,
    order: index
  }));
}

function buildBranches(messages) {
  return [{
    id: 'main',
    parentBranchId: null,
    rootMessageId: messages[0]?.id || null,
    leafMessageIds: messages.length ? [messages[messages.length - 1].id] : []
  }];
}

function normalizeImages(images = [], messageId) {
  return images.filter(isObject).map((image, index) => ({
    id: `${messageId}:image:${index + 1}`,
    name: image.file_name || `image-${index + 1}`,
    mimeType: image.file_type || image.format || 'image/png',
    size: image.size || 0,
    source: 'gemini',
    location: image.embedded_image?.data || image.data || null
  }));
}

export function geminiToArchiveRecord(processedData) {
  const messages = normalizeMessages(processedData);
  return createConversationRecord({
    id: firstString(processedData.meta_info?.uuid) || `gemini-${Date.now()}`,
    title: firstString(processedData.meta_info?.title) || 'Gemini conversation',
    platform: 'gemini',
    provider: 'google',
    providerConversationId: firstString(processedData.meta_info?.uuid),
    createdAt: firstString(processedData.meta_info?.created_at),
    updatedAt: firstString(processedData.meta_info?.updated_at),
    metadata: { model: firstString(processedData.meta_info?.model), format: processedData.format || 'gemini_notebooklm' },
    branches: buildBranches(messages),
    messages: messages.map(message => {
      const source = message.source;
      const text = source.display_text || source.raw_text || '';
      return {
        id: message.id,
        parentId: message.parentId,
        branchId: 'main',
        role: mapRole(source.sender),
        createdAt: source.timestamp || null,
        text,
        content: [{ type: 'text', text }],
        attachments: normalizeImages(source.images, message.id),
        citations: source.citations || [],
        thinking: source.thinking || null,
        toolCalls: source.tools || []
      };
    })
  });
}
