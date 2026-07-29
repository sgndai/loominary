import { createConversationRecord } from './normalizedAdapter.mjs';

const ROOT_UUID = '00000000-0000-4000-8000-000000000000';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function firstString(...values) {
  return values.find(value => typeof value === 'string' && value.length > 0) || null;
}

function compact(target, entries) {
  for (const [key, value] of entries) {
    if (value !== undefined && value !== null) target[key] = value;
  }
  return target;
}

function mapRole(sender) {
  if (sender === 'human' || sender === 'user') return 'user';
  if (sender === 'assistant') return 'assistant';
  if (sender === 'system') return 'system';
  if (sender === 'developer') return 'developer';
  if (sender === 'tool') return 'tool';
  return 'unknown';
}

function normalizeAttachments(attachments = [], messageId) {
  return attachments.filter(isObject).map((item, index) => {
    const sizeValue = Number(item.file_size ?? item.size ?? 0);
    const metadata = compact({}, [
      ['extractedContent', firstString(item.extracted_content, item.extractedContent)],
      ['embeddedImage', typeof item.is_embedded_image === 'boolean' ? item.is_embedded_image : null],
      ['hasLink', typeof item.has_link === 'boolean' ? item.has_link : null]
    ]);
    return compact(
      {
        id: firstString(item.id) || `${messageId}:attachment:${index + 1}`,
        name: firstString(item.file_name, item.name) || 'unknown-file',
        mimeType: firstString(item.file_type, item.mimeType),
        size: Number.isFinite(sizeValue) && sizeValue >= 0 ? sizeValue : 0,
        source: 'chatgpt',
        location: firstString(item.link, item.url, item.download_url, item.href)
      },
      [['metadata', Object.keys(metadata).length > 0 ? metadata : null]]
    );
  });
}

function normalizeCitations(citations = []) {
  return citations.filter(isObject).map(item => {
    const providerMetadata = isObject(item.metadata) ? item.metadata : {};
    const url = firstString(item.url, item.link, providerMetadata.url);
    const providerType = firstString(item.type, providerMetadata.type);
    return compact(
      {
        type: url ? 'url' : providerType || 'unknown'
      },
      [
        ['url', url],
        ['title', firstString(item.title, providerMetadata.title)],
        ['matchedText', firstString(item.matchedText, item.matched_text, item.text, item.alt)],
        ['sourceType', firstString(item.sourceType, providerMetadata.type, providerMetadata.source) || 'provider'],
        ['metadata', Object.keys(providerMetadata).length > 0 ? providerMetadata : null]
      ]
    );
  });
}

function normalizeTools(tools = []) {
  return tools.filter(isObject).map(tool => compact(
    {
      name: firstString(tool.name) || 'unknown_tool',
      input: tool.input === undefined ? null : tool.input,
      result: tool.result === undefined ? null : tool.result
    },
    [
      ['id', firstString(tool.id)],
      ['createdAt', firstString(tool.createdAt)],
      ['status', firstString(tool.status)]
    ]
  ));
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableConversationId(meta, rawData) {
  const explicit = firstString(meta.uuid, meta.id, rawData.conversation_id, rawData.id);
  if (explicit) return explicit;
  const title = String(meta.title || 'unknown').trim();
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `chatgpt-${slug || stableHash(title)}`;
}

function normalizeLegacyMessages(processedData) {
  return (processedData.chat_history || []).filter(isObject).map((message, index) => ({
    source: message,
    id: firstString(message.uuid, message._node_id) || `chatgpt-message-${index + 1}`,
    parentId: !message.parent_uuid || message.parent_uuid === ROOT_UUID ? null : message.parent_uuid,
    order: Number.isFinite(message.index) ? message.index : index
  }));
}

function currentPathNodeIds(rawData) {
  const result = new Set();
  const mapping = isObject(rawData.mapping) ? rawData.mapping : {};
  let nodeId = rawData.current_node;
  while (nodeId && !result.has(nodeId)) {
    result.add(nodeId);
    nodeId = mapping[nodeId]?.parent || null;
  }
  return result;
}

function assignDerivedBranchIds(messages, rawData) {
  const childrenByParent = new Map();
  const messageById = new Map(messages.map(message => [message.id, message]));
  for (const message of messages) {
    const parentId = message.parentId && messageById.has(message.parentId) ? message.parentId : null;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(message);
  }
  for (const children of childrenByParent.values()) {
    children.sort((a, b) => a.order - b.order);
  }

  const mainPath = currentPathNodeIds(rawData);
  const assigned = new Map();
  const usedBranches = new Set(['main']);
  const counters = new Map();
  const allocateBranch = parentId => {
    let next = (counters.get(parentId) || 0) + 1;
    let candidate = `${parentId}.${next}`;
    while (usedBranches.has(candidate)) {
      next += 1;
      candidate = `${parentId}.${next}`;
    }
    counters.set(parentId, next);
    usedBranches.add(candidate);
    return candidate;
  };

  const assign = (message, branchId) => {
    if (!message || assigned.has(message.id)) return;
    assigned.set(message.id, branchId);
    const children = childrenByParent.get(message.id) || [];
    if (children.length === 0) return;
    const mainChild = children.find(child => child.source._node_id && mainPath.has(child.source._node_id)) || children[0];
    assign(mainChild, branchId);
    for (const child of children) {
      if (child !== mainChild) assign(child, allocateBranch(branchId));
    }
  };

  const roots = childrenByParent.get(null) || [];
  roots.forEach((root, index) => assign(root, index === 0 ? 'main' : allocateBranch('main')));
  for (const message of messages) {
    if (!assigned.has(message.id)) assign(message, allocateBranch('main'));
  }
  return assigned;
}

function resolveBranchIds(messages, rawData) {
  if (messages.length > 0 && messages.every(message => firstString(message.source.branch_id))) {
    return new Map(messages.map(message => [message.id, message.source.branch_id]));
  }
  return assignDerivedBranchIds(messages, rawData);
}

function buildBranches(messages, branchIds) {
  const childrenByParent = new Map();
  for (const message of messages) {
    if (!childrenByParent.has(message.parentId)) childrenByParent.set(message.parentId, []);
    childrenByParent.get(message.parentId).push(message.id);
  }

  const groups = new Map();
  for (const message of messages) {
    const branchId = branchIds.get(message.id) || 'main';
    if (!groups.has(branchId)) groups.set(branchId, []);
    groups.get(branchId).push(message);
  }

  return Array.from(groups.entries()).map(([branchId, branchMessages]) => {
    const root = branchMessages.find(message => {
      const parentBranch = message.parentId ? branchIds.get(message.parentId) : null;
      return !message.parentId || parentBranch !== branchId;
    }) || branchMessages[0];
    const directParentBranch = root.parentId ? branchIds.get(root.parentId) : null;
    const inferredParent = branchId.includes('.') ? branchId.slice(0, branchId.lastIndexOf('.')) : null;
    const parentBranchId = directParentBranch && directParentBranch !== branchId
      ? directParentBranch
      : inferredParent && groups.has(inferredParent)
        ? inferredParent
        : null;
    const leafMessageIds = branchMessages
      .filter(message => (childrenByParent.get(message.id) || []).every(childId => branchIds.get(childId) !== branchId))
      .map(message => message.id);
    return {
      id: branchId,
      parentBranchId,
      rootMessageId: root.id,
      leafMessageIds: leafMessageIds.length > 0 ? leafMessageIds : [branchMessages[branchMessages.length - 1].id]
    };
  });
}

export function chatgptToArchiveRecord(processedData) {
  const meta = processedData.meta_info || {};
  const rawData = isObject(processedData.raw_data) ? processedData.raw_data : {};
  const legacyMessages = normalizeLegacyMessages(processedData);
  const branchIds = resolveBranchIds(legacyMessages, rawData);
  const branches = buildBranches(legacyMessages, branchIds);

  return createConversationRecord({
    id: stableConversationId(meta, rawData),
    title: meta.title,
    platform: 'chatgpt',
    provider: 'openai',
    providerConversationId: firstString(meta.uuid, rawData.conversation_id, rawData.id),
    createdAt: meta.created_at || null,
    updatedAt: meta.updated_at || null,
    favorite: typeof meta.is_starred === 'boolean' ? meta.is_starred : undefined,
    metadata: compact({}, [
      ['model', firstString(meta.model)],
      ['format', firstString(processedData.format) || 'chatgpt'],
      ['currentNode', firstString(rawData.current_node)]
    ]),
    messages: legacyMessages.map(message => ({
      id: message.id,
      parentId: message.parentId,
      branchId: branchIds.get(message.id) || 'main',
      role: mapRole(message.source.sender),
      createdAt: message.source.timestamp || null,
      text: message.source.display_text || message.source.raw_text || '',
      attachments: normalizeAttachments(message.source.attachments, message.id),
      citations: normalizeCitations(message.source.citations),
      thinking: message.source.thinking || null,
      toolCalls: normalizeTools(message.source.tools),
      metadata: compact({}, [
        ['providerNodeId', firstString(message.source._node_id)],
        ['branchLevel', Number.isFinite(message.source.branch_level) ? message.source.branch_level : null],
        ['isBranchPoint', typeof message.source.is_branch_point === 'boolean' ? message.source.is_branch_point : null]
      ])
    })),
    branches
  });
}
