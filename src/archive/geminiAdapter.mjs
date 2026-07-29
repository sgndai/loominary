import { validateContextRecord } from '../../server/archive/contract.mjs';
import { createConversationRecord } from './normalizedAdapter.mjs';

const ROOT_UUID = '00000000-0000-4000-8000-000000000000';
const GENERATED_EXPORT_ID = /^(?:gemini|notebooklm|aistudio)_\d{10,}$/i;

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

function platformOf(processedData, meta, rawData) {
  const value = firstString(processedData.platform, meta.platform, rawData.platform, 'gemini').toLowerCase();
  return ['gemini', 'notebooklm', 'aistudio'].includes(value) ? value : 'gemini';
}

function providerId(meta, rawData) {
  return [
    rawData.conversationId,
    rawData.conversation_id,
    rawData.uuid,
    rawData.id,
    meta.providerConversationId,
    meta.provider_conversation_id,
    meta.uuid,
    meta.id
  ].find(value => typeof value === 'string' && value.trim() && !GENERATED_EXPORT_ID.test(value.trim()))?.trim() || null;
}

function roleOf(sender) {
  if (sender === 'human' || sender === 'user') return 'user';
  if (sender === 'assistant' || sender === 'model') return 'assistant';
  if (['system', 'developer', 'tool'].includes(sender)) return sender;
  return 'unknown';
}

function rawMessageIndex(rawData) {
  const index = new Map();
  const turns = Array.isArray(rawData.conversation) ? rawData.conversation : [];
  turns.forEach((turn, position) => {
    const turnIndex = Number.isFinite(turn?.turnIndex) ? turn.turnIndex : position;
    for (const role of ['human', 'assistant']) {
      const value = turn?.[role];
      if (Array.isArray(value?.versions)) {
        value.versions.forEach((version, versionIndex) => {
          const id = Number.isFinite(version?.version) ? version.version : versionIndex;
          index.set(`${role}_${turnIndex}_v${id}`, version);
        });
      } else if (isObject(value)) {
        index.set(`${role}_${turnIndex}`, value);
      }
    }
  });
  return index;
}

function legacyMessages(processedData, fallbackId) {
  const messages = (processedData.chat_history || []).filter(isObject).map((source, index) => ({
    source,
    id: firstString(source.uuid) || `${fallbackId}:message:${index + 1}`,
    parentCandidate: firstString(source.parent_uuid),
    order: Number.isFinite(source.index) ? source.index : index
  }));
  const ids = new Set(messages.map(message => message.id));
  return messages.map(message => ({
    ...message,
    parentId: message.parentCandidate && message.parentCandidate !== ROOT_UUID && ids.has(message.parentCandidate)
      ? message.parentCandidate
      : null
  }));
}

function conversationId(meta, rawData, platform, messages) {
  const explicit = providerId(meta, rawData);
  if (explicit) return explicit;
  const title = firstString(meta.title, rawData.title, 'Untitled conversation');
  const signature = messages.slice(0, 12)
    .map(message => `${message.source.sender || ''}:${message.source.display_text || message.source.raw_text || ''}`)
    .join('|');
  return `${platform}-${stableHash(`${platform}|${title}|${signature}`)}`;
}

function canonicalVersionRank(message) {
  const version = Number.isFinite(message.source._version) ? message.source._version : null;
  const versionType = firstString(message.source._version_type) || (version === 0 ? 'normal' : null);
  if (version === 0 && versionType === 'normal') return 2;
  if (version === 0) return 1;
  return 0;
}

function deriveBranches(messages) {
  const children = new Map();
  for (const message of messages) {
    if (!children.has(message.parentId)) children.set(message.parentId, []);
    children.get(message.parentId).push(message);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.order - b.order);

  const depths = new Map();
  const depth = message => {
    if (depths.has(message.id)) return depths.get(message.id);
    const descendants = children.get(message.id) || [];
    const value = descendants.length ? 1 + Math.max(...descendants.map(depth)) : 0;
    depths.set(message.id, value);
    return value;
  };
  messages.forEach(depth);
  const chooseMain = siblings => [...siblings].sort((a, b) =>
    canonicalVersionRank(b) - canonicalVersionRank(a) ||
    depth(b) - depth(a) ||
    (Number.isFinite(a.source._version) ? a.source._version : Number.MAX_SAFE_INTEGER) -
      (Number.isFinite(b.source._version) ? b.source._version : Number.MAX_SAFE_INTEGER) ||
    a.order - b.order
  )[0];

  const ids = new Map();
  const counters = new Map();
  const nextBranch = parent => {
    const number = (counters.get(parent) || 0) + 1;
    counters.set(parent, number);
    return `${parent}.${number}`;
  };
  const assign = (message, branchId) => {
    if (!message || ids.has(message.id)) return;
    ids.set(message.id, branchId);
    const siblings = children.get(message.id) || [];
    if (!siblings.length) return;
    const main = chooseMain(siblings);
    assign(main, branchId);
    for (const sibling of siblings) if (sibling !== main) assign(sibling, nextBranch(branchId));
  };

  const roots = children.get(null) || [];
  if (roots.length) {
    const main = chooseMain(roots);
    assign(main, 'main');
    for (const root of roots) if (root !== main) assign(root, nextBranch('main'));
  }
  messages.forEach(message => { if (!ids.has(message.id)) assign(message, nextBranch('main')); });
  return ids;
}

function branchIdsFor(messages) {
  if (messages.length && messages.every(message => firstString(message.source.branch_id))) {
    return new Map(messages.map(message => [message.id, message.source.branch_id]));
  }
  return deriveBranches(messages);
}

function branchRecords(messages, branchIds) {
  if (!messages.length) return [];
  const children = new Map();
  const groups = new Map();
  for (const message of messages) {
    if (!children.has(message.parentId)) children.set(message.parentId, []);
    children.get(message.parentId).push(message.id);
    const branchId = branchIds.get(message.id) || 'main';
    if (!groups.has(branchId)) groups.set(branchId, []);
    groups.get(branchId).push(message);
  }
  return [...groups].map(([id, branchMessages]) => {
    const root = branchMessages.find(message => !message.parentId || branchIds.get(message.parentId) !== id) || branchMessages[0];
    const directParent = root.parentId ? branchIds.get(root.parentId) : null;
    const inferredParent = id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : null;
    const parentBranchId = directParent && directParent !== id
      ? directParent
      : inferredParent && groups.has(inferredParent) ? inferredParent : null;
    const leaves = branchMessages
      .filter(message => (children.get(message.id) || []).every(child => branchIds.get(child) !== id))
      .map(message => message.id);
    return { id, parentBranchId, rootMessageId: root.id, leafMessageIds: leaves.length ? leaves : [branchMessages.at(-1).id] };
  });
}

function attachment(item, messageId, index, kind) {
  if (!isObject(item)) return null;
  const format = firstString(item.file_type, item.mimeType, item.mime_type, item.format);
  const raw = firstString(item.data);
  const location = firstString(
    item.embedded_image?.data,
    raw?.startsWith('data:') ? raw : null,
    raw && format ? `data:${format};base64,${raw}` : null,
    item.link,
    item.url,
    item.file_url,
    item.preview_url,
    item.thumbnail_url,
    item.download_url
  );
  const size = Number(item.file_size ?? item.size ?? item.embedded_image?.size ?? 0);
  return compact({
    id: firstString(item.id, item.file_uuid) || `${messageId}:${kind}:${index + 1}`,
    name: firstString(item.file_name, item.name, item.title) || `${kind}-${index + 1}`,
    mimeType: format || (kind === 'image' ? 'image/png' : null),
    size: Number.isFinite(size) && size >= 0 ? size : 0,
    source: 'gemini',
    location
  }, [['metadata', compact({}, [
    ['displayMode', firstString(item.display_mode)],
    ['originalSource', firstString(item.original_src)]
  ])]]);
}

function attachmentsOf(source, supplement, messageId) {
  const result = [];
  for (const [kind, values] of [
    ['image', source.images], ['image', supplement.images],
    ['attachment', source.attachments], ['attachment', supplement.attachments],
    ['file', source.files], ['file', supplement.files],
    ['generated-file', source.generatedFiles], ['generated-file', supplement.generatedFiles],
    ['generated-file', supplement.generated_files]
  ]) {
    if (!Array.isArray(values)) continue;
    values.forEach((item, index) => { const value = attachment(item, messageId, index, kind); if (value) result.push(value); });
  }
  const seen = new Set();
  return result.filter(item => {
    const key = `${item.id}|${item.name}|${item.location || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function citationCandidates(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(citationCandidates);
  if (!isObject(value)) return [value];
  return [value, ...[
    value.citations,
    value.sources,
    value.groundingChunks,
    value.grounding_chunks,
    value.sourceAttributions,
    value.source_attributions
  ].flatMap(citationCandidates)];
}

function citation(item) {
  if (typeof item === 'string') {
    return /^https?:\/\//i.test(item) ? { type: 'url', url: item, sourceType: 'web' } : { type: 'source', title: item, sourceType: 'provider' };
  }
  if (!isObject(item)) return null;
  const web = isObject(item.web) ? item.web : {};
  const metadata = isObject(item.metadata) ? item.metadata : {};
  const url = firstString(item.url, item.uri, item.link, item.sourceUrl, item.source_url, web.uri, web.url, metadata.url);
  const title = firstString(item.title, item.name, item.label, web.title, metadata.title);
  const matchedText = firstString(item.matchedText, item.matched_text, item.text, item.snippet, item.excerpt, item.quote, item.segment?.text);
  const sourceType = firstString(item.sourceType, item.source_type, item.kind, item.type, item.provider, metadata.source) || (url ? 'web' : 'provider');
  if (!url && !title && !matchedText) return null;
  return compact({ type: url ? 'url' : 'source' }, [
    ['url', url], ['title', title], ['matchedText', matchedText], ['sourceType', sourceType],
    ['metadata', compact({}, [['sourceId', firstString(item.id, item.sourceId, item.source_id)]])]
  ]);
}

function citationsOf(source, supplement) {
  const values = [
    source.citations, source.sources, source.grounding, source.groundingMetadata, source.grounding_metadata,
    supplement.citations, supplement.sources, supplement.grounding, supplement.groundingMetadata, supplement.grounding_metadata
  ].flatMap(citationCandidates);
  const seen = new Set();
  return values.map(citation).filter(Boolean).filter(item => {
    const key = `${item.url || ''}|${item.title || ''}|${item.matchedText || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toolsOf(source, supplement) {
  return [source.tools, source.toolCalls, supplement.tools, supplement.toolCalls, supplement.tool_calls]
    .filter(Array.isArray).flat().filter(isObject).map((tool, index) => compact({
      name: firstString(tool.name, tool.function?.name) || `tool_${index + 1}`,
      input: tool.input ?? tool.arguments ?? tool.function?.arguments ?? null,
      result: tool.result ?? tool.output ?? null
    }, [['id', firstString(tool.id, tool.callId, tool.call_id)], ['status', firstString(tool.status)]]));
}

function canvasBlocks(canvas) {
  if (typeof canvas === 'string' && canvas.trim()) return [{ type: 'code', text: canvas.trim(), language: 'canvas' }];
  if (Array.isArray(canvas)) return canvas.map((item, index) => ({
    type: 'code', text: typeof item === 'string' ? item : JSON.stringify(item, null, 2), language: 'canvas', index
  }));
  if (isObject(canvas)) return [{ type: 'code', text: JSON.stringify(canvas, null, 2), language: 'canvas' }];
  return [];
}

function knowledgeFiles(rawData) {
  const notebook = isObject(rawData.notebook) ? rawData.notebook : {};
  const project = isObject(rawData.project) ? rawData.project : {};
  const values = [
    rawData.sources, rawData.sourceDocuments, rawData.source_documents, rawData.documents,
    rawData.knowledgeFiles, rawData.knowledge_files, notebook.sources, notebook.documents,
    notebook.knowledgeFiles, project.sources, project.documents, project.knowledgeFiles, project.knowledge_files
  ].find(Array.isArray) || [];
  return values.map((item, index) => {
    if (typeof item === 'string') return { id: `source-${stableHash(item)}`, name: item, summary: '' };
    const value = isObject(item) ? item : {};
    return compact({
      id: firstString(value.id, value.uuid, value.sourceId, value.source_id) || `source-${index + 1}`,
      name: firstString(value.name, value.title, value.file_name, value.displayName) || `Source ${index + 1}`,
      summary: firstString(value.summary, value.description, value.snippet, value.excerpt) || ''
    }, [['mimeType', firstString(value.mimeType, value.mime_type, value.file_type)], ['url', firstString(value.url, value.uri, value.link)]]);
  });
}

export function geminiToArchiveRecord(processedData) {
  const meta = isObject(processedData.meta_info) ? processedData.meta_info : {};
  const rawData = isObject(processedData.raw_data) ? processedData.raw_data : {};
  const platform = platformOf(processedData, meta, rawData);
  const rawIndex = rawMessageIndex(rawData);
  const provisional = legacyMessages(processedData, 'temporary');
  const id = conversationId(meta, rawData, platform, provisional);
  const messages = legacyMessages(processedData, id);
  const branchIds = branchIdsFor(messages);

  return createConversationRecord({
    id,
    title: firstString(meta.title, rawData.title) || 'Gemini conversation',
    platform,
    provider: 'google',
    providerConversationId: providerId(meta, rawData),
    createdAt: firstString(meta.created_at, rawData.createdAt, rawData.created_at, rawData.exportedAt),
    updatedAt: firstString(meta.updated_at, rawData.updatedAt, rawData.updated_at, rawData.exportedAt),
    metadata: compact({}, [
      ['model', firstString(meta.model, rawData.model)],
      ['format', firstString(processedData.format) || 'gemini_notebooklm'],
      ['sourceExportId', firstString(meta.uuid)]
    ]),
    branches: branchRecords(messages, branchIds),
    messages: messages.map(message => {
      const source = message.source;
      const supplement = rawIndex.get(message.id) || {};
      const text = source.display_text || source.raw_text || supplement.text || '';
      const canvas = source.canvas ?? supplement.canvas;
      return {
        id: message.id,
        parentId: message.parentId,
        branchId: branchIds.get(message.id) || 'main',
        role: roleOf(source.sender),
        createdAt: firstString(source.timestamp, supplement.createdAt, supplement.created_at),
        text,
        content: [{ type: 'text', text }, ...canvasBlocks(canvas)],
        attachments: attachmentsOf(source, supplement, message.id),
        citations: citationsOf(source, supplement),
        thinking: firstString(source.thinking, supplement.thinking),
        toolCalls: toolsOf(source, supplement),
        metadata: compact({}, [
          ['version', Number.isFinite(source._version) ? source._version : supplement.version],
          ['versionType', firstString(source._version_type, supplement.type)],
          ['userVersion', Number.isFinite(source._user_version) ? source._user_version : supplement.userVersion],
          ['hasCanvas', canvasBlocks(canvas).length ? true : null]
        ])
      };
    })
  });
}

export function geminiToContextRecord(processedData, suppliedConversationId = null) {
  const meta = isObject(processedData.meta_info) ? processedData.meta_info : {};
  const rawData = isObject(processedData.raw_data) ? processedData.raw_data : {};
  const platform = platformOf(processedData, meta, rawData);
  const notebook = isObject(rawData.notebook) ? rawData.notebook : {};
  const project = isObject(rawData.project) ? rawData.project : {};
  const files = knowledgeFiles(rawData);
  if (platform !== 'notebooklm' && !files.length && !Object.keys(notebook).length && !Object.keys(project).length) return null;

  const record = {
    schemaVersion: 'loominary.context/v1',
    conversationId: suppliedConversationId || conversationId(meta, rawData, platform, legacyMessages(processedData, 'temporary')),
    project: {
      id: firstString(notebook.id, notebook.uuid, project.id, project.uuid, rawData.notebookId, rawData.notebook_id, meta.project_uuid),
      name: firstString(notebook.name, notebook.title, project.name, project.title, rawData.notebookTitle, rawData.title, meta.title),
      description: firstString(notebook.description, notebook.summary, project.description, project.summary, rawData.description),
      instructions: firstString(notebook.instructions, project.instructions, project.custom_instructions, rawData.instructions),
      knowledgeFiles: files
    },
    memories: { global: [], project: [], saved: [] }
  };
  validateContextRecord(record);
  return record;
}

export function geminiToArchiveBundle(processedData) {
  const conversation = geminiToArchiveRecord(processedData);
  return { conversation, context: geminiToContextRecord(processedData, conversation.conversation.id) };
}
