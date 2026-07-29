import { createConversationRecord } from './normalizedAdapter.mjs';

const ROOT_UUID = '00000000-0000-4000-8000-000000000000';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const firstString = (...values) => values.find(value => typeof value === 'string' && value.trim())?.trim() || null;
const compact = (target, entries) => {
  for (const [key, value] of entries) if (value !== undefined && value !== null) target[key] = value;
  return target;
};

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function mapRole(sender) {
  if (sender === 'human' || sender === 'user') return 'user';
  if (sender === 'assistant' || sender === 'grok') return 'assistant';
  if (['system', 'developer', 'tool'].includes(sender)) return sender;
  return 'unknown';
}

function normalizeMessages(processedData, fallbackId) {
  const provisional = (processedData.chat_history || []).filter(isObject).map((source, index) => ({
    source,
    id: firstString(source.uuid, source.responseId) || `${fallbackId}:message:${index + 1}`,
    parentCandidate: firstString(source.parent_uuid, source.parentResponseId),
    order: Number.isFinite(source.index) ? source.index : index
  }));
  const ids = new Set(provisional.map(message => message.id));
  return provisional.map(message => ({
    ...message,
    parentId:
      message.parentCandidate &&
      message.parentCandidate !== ROOT_UUID &&
      ids.has(message.parentCandidate)
        ? message.parentCandidate
        : null
  }));
}

function stableConversationId(meta, rawData, messages) {
  const explicit = firstString(meta.uuid, rawData.conversationId, rawData.conversation_id, rawData.uuid, rawData.id);
  if (explicit) return explicit;
  const title = firstString(meta.title, rawData.title, 'Untitled conversation');
  const signature = messages.slice(0, 12)
    .map(message => `${message.source.sender || ''}:${message.source.display_text || message.source.raw_text || ''}`)
    .join('|');
  return `grok-${stableHash(`${title}|${signature}`)}`;
}

function treeNodeMap(rawData) {
  const nodes = Array.isArray(rawData.conversationTree?.nodes) ? rawData.conversationTree.nodes : [];
  return new Map(nodes.filter(isObject).map(node => [node.responseId, node]));
}

function deriveBranchIds(messages, rawData) {
  const childrenByParent = new Map();
  for (const message of messages) {
    if (!childrenByParent.has(message.parentId)) childrenByParent.set(message.parentId, []);
    childrenByParent.get(message.parentId).push(message);
  }
  const nodes = treeNodeMap(rawData);
  for (const [parentId, children] of childrenByParent) {
    const order = nodes.get(parentId)?.childResponseIds || [];
    children.sort((a, b) => {
      const aIndex = order.indexOf(a.id);
      const bIndex = order.indexOf(b.id);
      if (aIndex !== -1 || bIndex !== -1) {
        return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
      }
      return a.order - b.order;
    });
  }

  const branchIds = new Map();
  const counters = new Map();
  const allocate = parentBranch => {
    const next = (counters.get(parentBranch) || 0) + 1;
    counters.set(parentBranch, next);
    return `${parentBranch}.${next}`;
  };
  const assign = (message, branchId) => {
    if (!message || branchIds.has(message.id)) return;
    branchIds.set(message.id, branchId);
    const children = childrenByParent.get(message.id) || [];
    children.forEach((child, index) => assign(child, index === 0 ? branchId : allocate(branchId)));
  };

  const rootId = firstString(rawData.conversationTree?.rootNodeId);
  const roots = childrenByParent.get(null) || [];
  const mainRoot = roots.find(root => root.id === rootId) || roots[0];
  if (mainRoot) assign(mainRoot, 'main');
  for (const root of roots) if (root !== mainRoot) assign(root, allocate('main'));
  for (const message of messages) if (!branchIds.has(message.id)) assign(message, allocate('main'));
  return branchIds;
}

function resolveBranchIds(messages, rawData) {
  if (messages.length && messages.every(message => firstString(message.source.branch_id))) {
    return new Map(messages.map(message => [message.id, message.source.branch_id]));
  }
  return deriveBranchIds(messages, rawData);
}

function buildBranches(messages, branchIds) {
  if (!messages.length) return [];
  const childrenByParent = new Map();
  const groups = new Map();
  for (const message of messages) {
    if (!childrenByParent.has(message.parentId)) childrenByParent.set(message.parentId, []);
    childrenByParent.get(message.parentId).push(message.id);
    const branchId = branchIds.get(message.id) || 'main';
    if (!groups.has(branchId)) groups.set(branchId, []);
    groups.get(branchId).push(message);
  }
  return [...groups.entries()].map(([id, branchMessages]) => {
    const root = branchMessages.find(message => !message.parentId || branchIds.get(message.parentId) !== id) || branchMessages[0];
    const parentBranch = root.parentId ? branchIds.get(root.parentId) : null;
    const leaves = branchMessages
      .filter(message => (childrenByParent.get(message.id) || []).every(childId => branchIds.get(childId) !== id))
      .map(message => message.id);
    return {
      id,
      parentBranchId: parentBranch && parentBranch !== id ? parentBranch : null,
      rootMessageId: root.id,
      leafMessageIds: leaves.length ? leaves : [branchMessages.at(-1).id]
    };
  });
}

function normalizeAttachment(item, messageId, index, kind) {
  if (!isObject(item)) return null;
  const mimeType = firstString(item.file_type, item.mimeType, item.mime_type, item.format);
  const rawData = firstString(item.data);
  const location = firstString(
    item.embedded_image?.data,
    rawData?.startsWith('data:') ? rawData : null,
    rawData && mimeType ? `data:${mimeType};base64,${rawData}` : null,
    item.url,
    item.link,
    item.file_url,
    item.preview_url,
    item.thumbnail_url,
    item.original_src,
    item.download_url
  );
  const size = Number(item.file_size ?? item.size ?? item.embedded_image?.size ?? 0);
  const metadata = compact({}, [
    ['kind', kind],
    ['displayMode', firstString(item.display_mode)],
    ['captureSource', firstString(item.source)],
    ['embeddedImage', typeof item.is_embedded_image === 'boolean' ? item.is_embedded_image : null]
  ]);
  return compact({
    id: firstString(item.id, item.file_uuid) || `${messageId}:${kind}:${index + 1}`,
    name: firstString(item.file_name, item.fileName, item.name, item.title) || `${kind}-${index + 1}`,
    mimeType: mimeType || (kind === 'image' ? 'image/jpeg' : null),
    size: Number.isFinite(size) && size >= 0 ? size : 0,
    source: 'grok',
    location
  }, [['metadata', Object.keys(metadata).length ? metadata : null]]);
}

function normalizeAttachments(source, messageId) {
  const result = [];
  for (const [kind, values] of [['attachment', source.attachments], ['image', source.images]]) {
    if (!Array.isArray(values)) continue;
    values.forEach((item, index) => {
      const value = normalizeAttachment(item, messageId, index, kind);
      if (value) result.push(value);
    });
  }
  const seen = new Set();
  return result.filter(item => {
    const key = `${item.id}|${item.name}|${item.location || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeCitation(item, fallbackSourceType = 'provider') {
  if (typeof item === 'string') {
    return /^https?:\/\//i.test(item)
      ? { type: 'url', url: item, sourceType: 'web' }
      : { type: 'source', title: item, sourceType: fallbackSourceType };
  }
  if (!isObject(item)) return null;
  const url = firstString(item.url, item.uri, item.link);
  const title = firstString(item.title, item.name);
  const matchedText = firstString(item.matchedText, item.matched_text, item.snippet, item.text, item.excerpt);
  if (!url && !title && !matchedText) return null;
  return compact({ type: url ? 'url' : 'source' }, [
    ['url', url],
    ['title', title],
    ['matchedText', matchedText],
    ['sourceType', firstString(item.sourceType, item.source_type, item.type) || fallbackSourceType],
    ['metadata', compact({}, [['providerId', firstString(item.id)]])]
  ]);
}

function normalizeCitations(source) {
  const result = [];
  for (const [items, sourceType] of [[source.citations, 'citation'], [source.web_search_results, 'web-search']]) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const value = normalizeCitation(item, sourceType);
      if (value) result.push(value);
    }
  }
  const seen = new Set();
  return result.filter(item => {
    const key = `${item.url || ''}|${item.title || ''}|${item.matchedText || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeTools(source) {
  const tools = Array.isArray(source.tools)
    ? source.tools.filter(isObject).map((tool, index) => compact({
        name: firstString(tool.name) || `tool_${index + 1}`,
        input: tool.input ?? null,
        result: tool.result ?? null
      }, [['id', firstString(tool.id)], ['status', firstString(tool.status)]]))
    : [];
  if (Array.isArray(source.web_search_results) && source.web_search_results.length) {
    tools.push({ name: 'web_search', input: null, result: source.web_search_results });
  }
  return tools;
}

export function grokToArchiveRecord(processedData) {
  const meta = isObject(processedData.meta_info) ? processedData.meta_info : {};
  const rawData = isObject(processedData.raw_data) ? processedData.raw_data : {};
  const provisional = normalizeMessages(processedData, 'temporary');
  const id = stableConversationId(meta, rawData, provisional);
  const messages = normalizeMessages(processedData, id);
  const branchIds = resolveBranchIds(messages, rawData);

  return createConversationRecord({
    id,
    title: firstString(meta.title, rawData.title) || 'Grok conversation',
    platform: 'grok',
    provider: 'xai',
    providerConversationId: firstString(meta.uuid, rawData.conversationId, rawData.conversation_id),
    createdAt: firstString(meta.created_at, rawData.exportTime),
    updatedAt: firstString(meta.updated_at, rawData.exportTime),
    metadata: compact({}, [
      ['model', firstString(meta.model) || 'Grok'],
      ['format', firstString(processedData.format) || 'grok'],
      ['rootNodeId', firstString(rawData.conversationTree?.rootNodeId)],
      ['hasEmbeddedImages', typeof meta.has_embedded_images === 'boolean' ? meta.has_embedded_images : null],
      ['imagesProcessed', Number.isFinite(meta.images_processed) ? meta.images_processed : null]
    ]),
    branches: buildBranches(messages, branchIds),
    messages: messages.map(message => {
      const source = message.source;
      const text = source.display_text || source.raw_text || source.message || '';
      return {
        id: message.id,
        parentId: message.parentId,
        branchId: branchIds.get(message.id) || 'main',
        role: mapRole(source.sender),
        createdAt: firstString(source.timestamp, source.createTime),
        text,
        content: [{ type: 'text', text }],
        attachments: normalizeAttachments(source, message.id),
        citations: normalizeCitations(source),
        thinking: firstString(source.thinking),
        toolCalls: normalizeTools(source),
        metadata: compact({}, [
          ['threadId', firstString(source.threadId)],
          ['branchLevel', Number.isFinite(source.branch_level) ? source.branch_level : null],
          ['isBranchPoint', typeof source.is_branch_point === 'boolean' ? source.is_branch_point : null],
          ['childResponseIds', Array.isArray(source.childResponseIds) ? source.childResponseIds : null]
        ])
      };
    })
  });
}
