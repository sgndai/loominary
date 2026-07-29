const ROOT_UUID = '00000000-0000-4000-8000-000000000000';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function firstString(...values) {
  return values.find(value => typeof value === 'string' && value.length > 0) || null;
}

function roleToSender(role) {
  if (role === 'user') return 'human';
  if (role === 'assistant' || role === 'system' || role === 'developer' || role === 'tool') return role;
  return 'unknown';
}

function textFromPart(part) {
  if (typeof part === 'string') return part;
  if (!isObject(part)) return '';
  return firstString(part.text, part.content, part.caption) || '';
}

function messageText(message) {
  const content = isObject(message?.content) ? message.content : {};
  if (Array.isArray(content.parts)) {
    return content.parts.map(textFromPart).filter(Boolean).join('\n');
  }
  return firstString(content.text, message?.text) || '';
}

function normalizeAttachment(item, messageId, index) {
  if (!isObject(item)) return null;
  const mimeType = firstString(item.mimeType, item.mime_type, item.file_type, item.format);
  const data = firstString(item.data, item.base64);
  const location = firstString(
    item.location,
    item.url,
    item.download_url,
    item.asset_pointer,
    item.original_src,
    data && mimeType ? `data:${mimeType};base64,${data}` : null
  );
  const sizeValue = Number(item.size ?? item.file_size ?? 0);
  return {
    id: firstString(item.id, item.file_id, item.asset_pointer) || `${messageId}:attachment:${index + 1}`,
    name: firstString(item.name, item.file_name) || `attachment-${index + 1}`,
    mimeType,
    size: Number.isFinite(sizeValue) && sizeValue >= 0 ? sizeValue : 0,
    location,
    original_src: firstString(item.original_src)
  };
}

function collectAttachments(node, message, messageId) {
  const candidates = [];
  const metadata = isObject(message?.metadata) ? message.metadata : {};
  if (Array.isArray(metadata.attachments)) candidates.push(...metadata.attachments);

  const parts = isObject(message?.content) && Array.isArray(message.content.parts)
    ? message.content.parts
    : [];
  for (const part of parts) {
    if (isObject(part) && (
      part.asset_pointer || part.file_id || part.url || part.location || part.content_type === 'image_asset_pointer'
    )) {
      candidates.push(part);
    }
  }

  const imageGroups = isObject(node?.loominary_images) ? node.loominary_images : {};
  for (const values of Object.values(imageGroups)) {
    if (Array.isArray(values)) candidates.push(...values);
  }

  return candidates
    .map((item, index) => normalizeAttachment(item, messageId, index))
    .filter(Boolean);
}

function collectCitations(message) {
  const metadata = isObject(message?.metadata) ? message.metadata : {};
  const values = Array.isArray(metadata.citations)
    ? metadata.citations
    : Array.isArray(message?.citations)
      ? message.citations
      : [];
  return values.filter(isObject).map(item => ({
    url: firstString(item.url, item.link),
    title: firstString(item.title, item.name),
    matchedText: firstString(item.matchedText, item.matched_text, item.text)
  }));
}

function orderedNodeIds(mapping) {
  const ids = Object.keys(mapping);
  const children = new Map(ids.map(id => [id, []]));
  const roots = [];

  for (const id of ids) {
    const parent = mapping[id]?.parent;
    if (parent && children.has(parent)) children.get(parent).push(id);
    else roots.push(id);
  }

  const result = [];
  const seen = new Set();
  const visit = id => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    result.push(id);
    const declared = Array.isArray(mapping[id]?.children) ? mapping[id].children : [];
    const next = [...declared, ...(children.get(id) || [])];
    for (const child of next) visit(child);
  };

  roots.forEach(visit);
  ids.forEach(visit);
  return result;
}

export function normalizeChatgptRawConversation(rawData) {
  if (!isObject(rawData) || !isObject(rawData.mapping)) {
    throw new TypeError('Raw ChatGPT conversation mapping is required');
  }

  const nodeMessageIds = new Map();
  for (const [nodeId, node] of Object.entries(rawData.mapping)) {
    if (isObject(node?.message)) {
      nodeMessageIds.set(nodeId, firstString(node.message.id) || nodeId);
    }
  }

  const parentMessageId = nodeId => {
    let parentNodeId = rawData.mapping[nodeId]?.parent || null;
    const visited = new Set();
    while (parentNodeId && !visited.has(parentNodeId)) {
      visited.add(parentNodeId);
      if (nodeMessageIds.has(parentNodeId)) return nodeMessageIds.get(parentNodeId);
      parentNodeId = rawData.mapping[parentNodeId]?.parent || null;
    }
    return ROOT_UUID;
  };

  const chatHistory = [];
  for (const nodeId of orderedNodeIds(rawData.mapping)) {
    const node = rawData.mapping[nodeId];
    const message = node?.message;
    if (!isObject(message)) continue;

    const messageId = nodeMessageIds.get(nodeId) || nodeId;
    chatHistory.push({
      index: chatHistory.length,
      uuid: messageId,
      _node_id: nodeId,
      parent_uuid: parentMessageId(nodeId),
      sender: roleToSender(message.author?.role),
      timestamp: message.create_time ? new Date(message.create_time * 1000).toISOString() : null,
      display_text: messageText(message),
      attachments: collectAttachments(node, message, messageId),
      citations: collectCitations(message),
      tools: [],
      thinking: null
    });
  }

  return {
    format: 'chatgpt',
    meta_info: {
      uuid: firstString(rawData.conversation_id, rawData.id),
      title: firstString(rawData.title) || 'Untitled',
      created_at: rawData.create_time ? new Date(rawData.create_time * 1000).toISOString() : null,
      updated_at: rawData.update_time ? new Date(rawData.update_time * 1000).toISOString() : null,
      platform: 'chatgpt'
    },
    raw_data: rawData,
    chat_history: chatHistory
  };
}
