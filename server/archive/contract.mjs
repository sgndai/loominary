export const ARCHIVE_SCHEMA_VERSION = 'loominary.archive/v1';
export const CONVERSATION_SCHEMA_VERSION = 'loominary.conversation/v1';
export const CONTEXT_SCHEMA_VERSION = 'loominary.context/v1';
export const ANNOTATIONS_SCHEMA_VERSION = 'loominary.annotations/v1';

const MESSAGE_ROLES = new Set(['system', 'developer', 'user', 'assistant', 'tool', 'unknown']);
const TEXT_BLOCK_TYPES = new Set(['text', 'markdown', 'code', 'thinking']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(path, message) {
  throw new Error(`${path} ${message}`);
}

function requireObject(value, path) {
  if (!isObject(value)) fail(path, 'must be an object.');
  return value;
}

function requireArray(value, path) {
  if (!Array.isArray(value)) fail(path, 'must be an array.');
  return value;
}

function requireString(value, path) {
  if (typeof value !== 'string' || value.length === 0) fail(path, 'must be a non-empty string.');
  return value;
}

function optionalString(value, path) {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    fail(path, 'must be a string or null.');
  }
}

function optionalBoolean(value, path) {
  if (value !== undefined && typeof value !== 'boolean') fail(path, 'must be a boolean.');
}

function validateStringArray(value, path) {
  requireArray(value, path);
  value.forEach((item, index) => requireString(item, `${path}[${index}]`));
}

export function validateContentBlock(block, path = 'content block') {
  requireObject(block, path);
  const type = requireString(block.type, `${path}.type`);

  if (TEXT_BLOCK_TYPES.has(type) && typeof block.text !== 'string') {
    fail(`${path}.text`, `must be a string for ${type} blocks.`);
  }
  if (type === 'unknown' && !isObject(block.raw)) {
    fail(`${path}.raw`, 'must be an object for unknown blocks.');
  }
  return block;
}

export function validateAttachment(attachment, path = 'attachment') {
  requireObject(attachment, path);
  requireString(attachment.id, `${path}.id`);
  requireString(attachment.name, `${path}.name`);
  optionalString(attachment.mimeType, `${path}.mimeType`);
  optionalString(attachment.source, `${path}.source`);
  optionalString(attachment.location, `${path}.location`);
  if (attachment.size !== undefined && (!Number.isFinite(attachment.size) || attachment.size < 0)) {
    fail(`${path}.size`, 'must be a non-negative number.');
  }
  if (attachment.metadata !== undefined) requireObject(attachment.metadata, `${path}.metadata`);
  return attachment;
}

export function validateCitation(citation, path = 'citation') {
  requireObject(citation, path);
  const type = requireString(citation.type, `${path}.type`);
  if (type === 'url') requireString(citation.url, `${path}.url`);
  optionalString(citation.url, `${path}.url`);
  optionalString(citation.title, `${path}.title`);
  optionalString(citation.matchedText, `${path}.matchedText`);
  optionalString(citation.sourceType, `${path}.sourceType`);
  if (citation.metadata !== undefined) requireObject(citation.metadata, `${path}.metadata`);
  return citation;
}

export function validateToolCall(toolCall, path = 'tool call') {
  requireObject(toolCall, path);
  requireString(toolCall.name, `${path}.name`);
  optionalString(toolCall.id, `${path}.id`);
  optionalString(toolCall.createdAt, `${path}.createdAt`);
  optionalString(toolCall.status, `${path}.status`);
  return toolCall;
}

export function validateMessage(message, path = 'message') {
  requireObject(message, path);
  requireString(message.id, `${path}.id`);
  optionalString(message.parentId, `${path}.parentId`);
  optionalString(message.branchId, `${path}.branchId`);
  optionalString(message.createdAt, `${path}.createdAt`);
  optionalString(message.text, `${path}.text`);

  const role = requireString(message.role, `${path}.role`);
  if (!MESSAGE_ROLES.has(role)) fail(`${path}.role`, `has unsupported value: ${role}.`);

  requireArray(message.content, `${path}.content`).forEach((block, index) => {
    validateContentBlock(block, `${path}.content[${index}]`);
  });

  if (message.attachments !== undefined) {
    requireArray(message.attachments, `${path}.attachments`).forEach((attachment, index) => {
      validateAttachment(attachment, `${path}.attachments[${index}]`);
    });
  }
  if (message.citations !== undefined) {
    requireArray(message.citations, `${path}.citations`).forEach((citation, index) => {
      validateCitation(citation, `${path}.citations[${index}]`);
    });
  }
  if (message.toolCalls !== undefined) {
    requireArray(message.toolCalls, `${path}.toolCalls`).forEach((toolCall, index) => {
      validateToolCall(toolCall, `${path}.toolCalls[${index}]`);
    });
  }
  if (
    message.thinking !== undefined &&
    message.thinking !== null &&
    typeof message.thinking !== 'string' &&
    !isObject(message.thinking)
  ) {
    fail(`${path}.thinking`, 'must be a string, object, or null.');
  }
  if (message.metadata !== undefined) requireObject(message.metadata, `${path}.metadata`);
  return message;
}

function validateBranch(branch, path) {
  requireObject(branch, path);
  requireString(branch.id, `${path}.id`);
  optionalString(branch.parentBranchId, `${path}.parentBranchId`);
  optionalString(branch.rootMessageId, `${path}.rootMessageId`);
  validateStringArray(branch.leafMessageIds, `${path}.leafMessageIds`);
  return branch;
}

export function validateManifest(manifest) {
  requireObject(manifest, 'Archive manifest');
  if (manifest.schemaVersion !== ARCHIVE_SCHEMA_VERSION) {
    throw new Error(`Unsupported archive schema version: ${manifest.schemaVersion || 'missing'}`);
  }
  requireString(manifest.archiveId, 'Archive manifest.archiveId');
  const layout = requireObject(manifest.layout, 'Archive manifest.layout');
  requireString(layout.conversationsDir, 'Archive manifest.layout.conversationsDir');
  requireString(layout.contextsDir, 'Archive manifest.layout.contextsDir');
  requireString(layout.annotationsFile, 'Archive manifest.layout.annotationsFile');
  optionalString(manifest.createdAt, 'Archive manifest.createdAt');
  optionalString(manifest.updatedAt, 'Archive manifest.updatedAt');
  return manifest;
}

export function validateConversationRecord(record) {
  requireObject(record, 'Conversation record');
  if (record.schemaVersion !== CONVERSATION_SCHEMA_VERSION) {
    throw new Error(`Unsupported conversation schema version: ${record.schemaVersion || 'missing'}`);
  }

  const conversation = requireObject(record.conversation, 'Conversation record.conversation');
  const conversationId = requireString(conversation.id, 'Conversation record.conversation.id');
  requireString(conversation.title, `Conversation ${conversationId}.conversation.title`);
  requireString(conversation.platform, `Conversation ${conversationId}.conversation.platform`);
  optionalString(conversation.provider, `Conversation ${conversationId}.conversation.provider`);
  optionalString(conversation.providerConversationId, `Conversation ${conversationId}.conversation.providerConversationId`);
  optionalString(conversation.createdAt, `Conversation ${conversationId}.conversation.createdAt`);
  optionalString(conversation.updatedAt, `Conversation ${conversationId}.conversation.updatedAt`);
  optionalBoolean(conversation.favorite, `Conversation ${conversationId}.conversation.favorite`);
  if (conversation.metadata !== undefined) {
    requireObject(conversation.metadata, `Conversation ${conversationId}.conversation.metadata`);
  }

  const branches = requireArray(record.branches, `Conversation ${conversationId}.branches`);
  const messages = requireArray(record.messages, `Conversation ${conversationId}.messages`);
  const branchIds = new Set();
  const messageIds = new Set();

  branches.forEach((branch, index) => {
    validateBranch(branch, `Conversation ${conversationId}.branches[${index}]`);
    if (branchIds.has(branch.id)) fail(`Conversation ${conversationId}.branches[${index}].id`, 'must be unique.');
    branchIds.add(branch.id);
  });

  messages.forEach((message, index) => {
    validateMessage(message, `Conversation ${conversationId}.messages[${index}]`);
    if (messageIds.has(message.id)) fail(`Conversation ${conversationId}.messages[${index}].id`, 'must be unique.');
    messageIds.add(message.id);
  });

  messages.forEach((message, index) => {
    if (message.parentId && !messageIds.has(message.parentId)) {
      fail(`Conversation ${conversationId}.messages[${index}].parentId`, `references missing message ${message.parentId}.`);
    }
    if (message.branchId && !branchIds.has(message.branchId)) {
      fail(`Conversation ${conversationId}.messages[${index}].branchId`, `references missing branch ${message.branchId}.`);
    }
  });

  branches.forEach((branch, index) => {
    if (branch.parentBranchId && !branchIds.has(branch.parentBranchId)) {
      fail(`Conversation ${conversationId}.branches[${index}].parentBranchId`, `references missing branch ${branch.parentBranchId}.`);
    }
    if (branch.rootMessageId && !messageIds.has(branch.rootMessageId)) {
      fail(`Conversation ${conversationId}.branches[${index}].rootMessageId`, `references missing message ${branch.rootMessageId}.`);
    }
    branch.leafMessageIds.forEach((messageId, leafIndex) => {
      if (!messageIds.has(messageId)) {
        fail(`Conversation ${conversationId}.branches[${index}].leafMessageIds[${leafIndex}]`, `references missing message ${messageId}.`);
      }
    });
  });

  return record;
}

export function validateContextRecord(record) {
  requireObject(record, 'Context record');
  if (record.schemaVersion !== CONTEXT_SCHEMA_VERSION) {
    throw new Error(`Unsupported context schema version: ${record.schemaVersion || 'missing'}`);
  }
  requireString(record.conversationId, 'Context record.conversationId');
  if (record.project !== undefined && record.project !== null) {
    const project = requireObject(record.project, 'Context record.project');
    optionalString(project.id, 'Context record.project.id');
    optionalString(project.name, 'Context record.project.name');
    optionalString(project.description, 'Context record.project.description');
    optionalString(project.instructions, 'Context record.project.instructions');
    if (project.knowledgeFiles !== undefined) {
      requireArray(project.knowledgeFiles, 'Context record.project.knowledgeFiles');
    }
  }
  if (record.memories !== undefined) {
    const memories = requireObject(record.memories, 'Context record.memories');
    for (const key of ['global', 'project', 'saved']) {
      if (memories[key] !== undefined) requireArray(memories[key], `Context record.memories.${key}`);
    }
  }
  return record;
}

export function validateAnnotations(record) {
  requireObject(record, 'Annotations record');
  if (record.schemaVersion !== ANNOTATIONS_SCHEMA_VERSION) {
    throw new Error(`Unsupported annotations schema version: ${record.schemaVersion || 'missing'}`);
  }
  validateStringArray(record.favorites, 'Annotations record.favorites');
  requireArray(record.tags, 'Annotations record.tags').forEach((tag, index) => {
    requireObject(tag, `Annotations record.tags[${index}]`);
    requireString(tag.tag, `Annotations record.tags[${index}].tag`);
    requireString(tag.conversationId, `Annotations record.tags[${index}].conversationId`);
    optionalString(tag.messageId, `Annotations record.tags[${index}].messageId`);
    optionalString(tag.createdAt, `Annotations record.tags[${index}].createdAt`);
    optionalString(tag.source, `Annotations record.tags[${index}].source`);
  });
  return record;
}
