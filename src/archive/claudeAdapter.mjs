import { validateContextRecord } from '../../server/archive/contract.mjs';
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

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableConversationId(meta, rawData) {
  const explicit = firstString(meta.uuid, meta.id, rawData.uuid, rawData.id);
  if (explicit) return explicit;
  const seed = `${meta.title || rawData.name || 'untitled'}|${meta.created_at || rawData.created_at || ''}`;
  return `claude-${stableHash(seed)}`;
}

function normalizeLegacyMessages(processedData, conversationId) {
  const sourceMessages = Array.isArray(processedData.chat_history) ? processedData.chat_history : [];
  const provisional = sourceMessages.filter(isObject).map((source, index) => ({
    source,
    id: firstString(source.uuid) || `${conversationId}:message:${index + 1}`,
    parentCandidate: firstString(source.parent_uuid),
    order: Number.isFinite(source.index) ? source.index : index
  }));
  const messageIds = new Set(provisional.map(message => message.id));
  return provisional.map(message => ({
    ...message,
    parentId:
      message.parentCandidate &&
      message.parentCandidate !== ROOT_UUID &&
      messageIds.has(message.parentCandidate)
        ? message.parentCandidate
        : null
  }));
}

function deriveBranchIds(messages) {
  const childrenByParent = new Map();
  for (const message of messages) {
    if (!childrenByParent.has(message.parentId)) childrenByParent.set(message.parentId, []);
    childrenByParent.get(message.parentId).push(message);
  }
  for (const children of childrenByParent.values()) children.sort((a, b) => a.order - b.order);

  const branchIds = new Map();
  const assign = (message, branchId) => {
    if (!message || branchIds.has(message.id)) return;
    branchIds.set(message.id, branchId);
    const children = childrenByParent.get(message.id) || [];
    children.forEach((child, index) => assign(child, index === 0 ? branchId : `${branchId}.${index}`));
  };
  const roots = childrenByParent.get(null) || [];
  roots.forEach((root, index) => assign(root, index === 0 ? 'main' : `branch_root_${index}`));
  messages.forEach((message, index) => {
    if (!branchIds.has(message.id)) assign(message, `orphan_${index + 1}`);
  });
  return branchIds;
}

function resolveBranchIds(messages) {
  if (messages.length > 0 && messages.every(message => firstString(message.source.branch_id))) {
    return new Map(messages.map(message => [message.id, message.source.branch_id]));
  }
  return deriveBranchIds(messages);
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

function normalizeAttachment(item, messageId, index, sourceKind = 'attachment') {
  if (!isObject(item)) return null;
  const sizeValue = Number(item.file_size ?? item.size ?? item.embedded_image?.size ?? 0);
  const location = firstString(
    item.link,
    item.file_url,
    item.preview_url,
    item.thumbnail_url,
    item.embedded_image?.data
  );
  const metadata = compact({}, [
    ['createdAt', firstString(item.created_at)],
    ['displayMode', firstString(item.display_mode)],
    ['extractedContent', firstString(item.extracted_content, item.extractedContent)],
    ['originalSource', firstString(item.original_src)]
  ]);
  return compact(
    {
      id: firstString(item.id, item.file_uuid) || `${messageId}:${sourceKind}:${index + 1}`,
      name: firstString(item.file_name, item.name) || `${sourceKind}-${index + 1}`,
      mimeType: firstString(item.file_type, item.mimeType) || (sourceKind === 'image' ? 'image/png' : null),
      size: Number.isFinite(sizeValue) && sizeValue >= 0 ? sizeValue : 0,
      source: 'claude',
      location
    },
    [['metadata', Object.keys(metadata).length > 0 ? metadata : null]]
  );
}

function normalizeAttachments(message, messageId) {
  const candidates = [];
  for (const [sourceKind, values] of [
    ['attachment', message.attachments],
    ['image', message.images]
  ]) {
    if (!Array.isArray(values)) continue;
    values.forEach((item, index) => {
      const normalized = normalizeAttachment(item, messageId, index, sourceKind);
      if (normalized) candidates.push(normalized);
    });
  }
  const seen = new Set();
  return candidates.filter(item => {
    const key = `${item.id}|${item.location || ''}|${item.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeCitations(citations = []) {
  return citations.filter(isObject).map(item => {
    const metadata = isObject(item.metadata) ? item.metadata : {};
    const url = firstString(item.url, item.link, metadata.url);
    const providerType = firstString(item.type, metadata.type);
    return compact(
      { type: url ? 'url' : providerType || 'unknown' },
      [
        ['url', url],
        ['title', firstString(item.title, item.document_title, metadata.title)],
        ['matchedText', firstString(item.matchedText, item.matched_text, item.cited_text, item.text)],
        ['sourceType', firstString(item.sourceType, metadata.source, providerType) || 'provider'],
        ['metadata', Object.keys(metadata).length > 0 ? metadata : null]
      ]
    );
  });
}

function normalizeToolCall(tool, fallbackName = 'unknown_tool') {
  if (!isObject(tool)) return null;
  return compact(
    {
      name: firstString(tool.name) || fallbackName,
      input: tool.input === undefined ? null : tool.input,
      result: tool.result === undefined ? null : tool.result
    },
    [
      ['id', firstString(tool.id)],
      ['createdAt', firstString(tool.createdAt, tool.created_at)],
      ['status', firstString(tool.status)]
    ]
  );
}

function normalizeToolCalls(message) {
  const result = [];
  if (Array.isArray(message.tools)) {
    for (const tool of message.tools) {
      const normalized = normalizeToolCall(tool);
      if (normalized) result.push(normalized);
    }
  }
  if (Array.isArray(message.artifacts)) {
    for (const artifact of message.artifacts) {
      const normalized = normalizeToolCall(
        {
          id: artifact?.id,
          name: 'artifacts',
          input: artifact,
          result: artifact?.result
        },
        'artifacts'
      );
      if (normalized) result.push(normalized);
    }
  }
  return result;
}

function normalizeContent(contentItems, fallbackText) {
  if (!Array.isArray(contentItems)) return null;
  const blocks = [];
  for (const item of contentItems) {
    if (!isObject(item)) continue;
    if (item.type === 'text') {
      blocks.push({ type: 'text', text: typeof item.text === 'string' ? item.text : '' });
    } else if (item.type === 'thinking') {
      blocks.push({ type: 'thinking', text: typeof item.thinking === 'string' ? item.thinking : '' });
    } else if (item.type === 'image') {
      blocks.push({ type: 'image', raw: item });
    } else if (item.type === 'tool_use') {
      blocks.push(compact(
        { type: 'tool-call', name: firstString(item.name) || 'unknown_tool', input: item.input ?? {} },
        [['id', firstString(item.id)]]
      ));
    } else if (item.type === 'tool_result') {
      blocks.push(compact(
        { type: 'tool-result', result: item.content ?? item.result ?? null, isError: !!item.is_error },
        [['toolUseId', firstString(item.tool_use_id, item.id)]]
      ));
    } else {
      blocks.push({ type: 'unknown', raw: item });
    }
  }
  if (blocks.length === 0 && typeof fallbackText === 'string') {
    return [{ type: 'text', text: fallbackText }];
  }
  return blocks.length > 0 ? blocks : null;
}

function normalizeKnowledgeFiles(project) {
  if (!isObject(project)) return [];
  const candidates =
    project.knowledgeFiles ||
    project.knowledge_files ||
    project.files ||
    project.documents ||
    project.docs ||
    [];
  if (!Array.isArray(candidates)) return [];
  return candidates.map((item, index) => {
    if (typeof item === 'string') {
      return { id: `knowledge-${stableHash(item)}`, name: item, summary: '' };
    }
    const value = isObject(item) ? item : {};
    return compact(
      {
        id: firstString(value.id, value.uuid, value.file_uuid) || `knowledge-${index + 1}`,
        name: firstString(value.name, value.file_name, value.title) || `Knowledge file ${index + 1}`,
        summary: firstString(value.summary, value.description, value.extracted_content) || ''
      },
      [['mimeType', firstString(value.mimeType, value.mime_type, value.file_type)]]
    );
  });
}

function normalizeMemoryItems(items, namespace) {
  if (!Array.isArray(items)) return [];
  return items.map((item, index) => {
    if (typeof item === 'string') {
      return { id: `${namespace}-${index + 1}`, title: '', content: item };
    }
    const value = isObject(item) ? item : {};
    return compact(
      {
        id: firstString(value.id, value.uuid) || `${namespace}-${index + 1}`,
        title: firstString(value.title, value.name) || '',
        content: firstString(value.content, value.text, value.value) || ''
      },
      [['metadata', isObject(value.metadata) ? value.metadata : null]]
    );
  });
}

function firstArray(sources, keys) {
  for (const source of sources) {
    if (!isObject(source)) continue;
    for (const key of keys) {
      if (Array.isArray(source[key])) return source[key];
    }
  }
  return [];
}

export function claudeToArchiveRecord(processedData) {
  const meta = isObject(processedData.meta_info) ? processedData.meta_info : {};
  const rawData = isObject(processedData.raw_data) ? processedData.raw_data : {};
  const conversationId = stableConversationId(meta, rawData);
  const legacyMessages = normalizeLegacyMessages(processedData, conversationId);
  const branchIds = resolveBranchIds(legacyMessages);
  const branches = buildBranches(legacyMessages, branchIds);

  return createConversationRecord({
    id: conversationId,
    title: firstString(meta.title, rawData.name) || 'Untitled conversation',
    platform: 'claude',
    provider: 'anthropic',
    providerConversationId: firstString(meta.uuid, rawData.uuid, rawData.id),
    createdAt: firstString(meta.created_at, rawData.created_at),
    updatedAt: firstString(meta.updated_at, rawData.updated_at),
    metadata: compact({}, [
      ['model', firstString(meta.model, rawData.model)],
      ['format', firstString(processedData.format) || 'claude'],
      ['projectId', firstString(meta.project_uuid, rawData.project_uuid)],
      ['organizationId', firstString(meta.organization_id, rawData.organization_id)],
      ['hasEmbeddedImages', typeof meta.has_embedded_images === 'boolean' ? meta.has_embedded_images : null],
      ['imagesProcessed', Number.isFinite(meta.images_processed) ? meta.images_processed : null]
    ]),
    messages: legacyMessages.map(message => {
      const text = message.source.display_text || message.source.raw_text || '';
      const artifacts = Array.isArray(message.source.artifacts) ? message.source.artifacts : [];
      return {
        id: message.id,
        parentId: message.parentId,
        branchId: branchIds.get(message.id) || 'main',
        role: mapRole(message.source.sender),
        createdAt: firstString(message.source.timestamp),
        text,
        content: normalizeContent(message.source.content_items, text),
        attachments: normalizeAttachments(message.source, message.id),
        citations: normalizeCitations(message.source.citations),
        thinking: firstString(message.source.thinking),
        toolCalls: normalizeToolCalls(message.source),
        metadata: compact({}, [
          ['branchLevel', Number.isFinite(message.source.branch_level) ? message.source.branch_level : null],
          ['isBranchPoint', typeof message.source.is_branch_point === 'boolean' ? message.source.is_branch_point : null],
          ['artifacts', artifacts.length > 0 ? artifacts : null]
        ])
      };
    }),
    branches
  });
}

export function claudeToContextRecord(processedData, conversationId = null) {
  const meta = isObject(processedData.meta_info) ? processedData.meta_info : {};
  const rawData = isObject(processedData.raw_data) ? processedData.raw_data : {};
  const project = isObject(meta.project)
    ? meta.project
    : isObject(rawData.project)
      ? rawData.project
      : null;
  const memorySources = [meta.memories, rawData.memories, project?.memories, rawData, project];
  const memories = {
    global: normalizeMemoryItems(firstArray(memorySources, ['global', 'global_memories']), 'global-memory'),
    project: normalizeMemoryItems(firstArray(memorySources, ['project', 'project_memories']), 'project-memory'),
    saved: normalizeMemoryItems(firstArray(memorySources, ['saved', 'saved_memories']), 'saved-memory')
  };
  const projectId = firstString(project?.id, project?.uuid, meta.project_uuid, rawData.project_uuid);
  const hasProject = !!(project || projectId);
  const hasMemories = Object.values(memories).some(items => items.length > 0);
  if (!hasProject && !hasMemories) return null;

  const record = {
    schemaVersion: 'loominary.context/v1',
    conversationId: conversationId || stableConversationId(meta, rawData),
    project: hasProject
      ? {
          id: projectId,
          name: firstString(project?.name, project?.title) || null,
          description: firstString(project?.description, project?.summary) || null,
          instructions: firstString(
            project?.instructions,
            project?.custom_instructions,
            project?.system_prompt,
            project?.prompt_template
          ) || null,
          knowledgeFiles: normalizeKnowledgeFiles(project)
        }
      : null,
    memories
  };
  validateContextRecord(record);
  return record;
}

export function claudeToArchiveBundle(processedData) {
  const conversation = claudeToArchiveRecord(processedData);
  return {
    conversation,
    context: claudeToContextRecord(processedData, conversation.conversation.id)
  };
}
