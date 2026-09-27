// chatgptParser.js
// ChatGPT 平台的解析器和分支检测

import {
  MessageBuilder,
  DateTimeUtils,
  PARSER_CONFIG,
  processAttachments,
  buildMessageMaps
} from './helpers.js';

// 从 base64 数据检测图片 MIME 类型
const detectMimeType = (base64Data, defaultType = 'image/png') => {
  if (!base64Data) return defaultType;
  const firstBytes = base64Data.substring(0, 20);
  if (firstBytes.startsWith('iVBORw0KGgo')) return 'image/png';
  if (firstBytes.startsWith('/9j/')) return 'image/jpeg';
  if (firstBytes.startsWith('R0lGOD')) return 'image/gif';
  if (firstBytes.startsWith('UklGR')) return 'image/webp';
  return defaultType;
};

// 处理 Loominary 导出的图片数据
const processLoominaryImage = (img, idx, prefix, metaInfo) => {
  if (img.type !== 'image' || !img.data) return null;
  let mimeType = img.format || 'image/png';
  if (mimeType === 'application/octet-stream' || !mimeType.startsWith('image/')) {
    mimeType = detectMimeType(img.data);
  }
  const fileExt = mimeType.split('/')[1] || 'png';
  return {
    id: `loominary_${prefix}_${idx}`,
    file_name: `${prefix}_${idx}.${fileExt}`,
    file_size: img.size || 0,
    file_type: mimeType,
    extracted_content: '',
    link: `data:${mimeType};base64,${img.data}`,
    has_link: true,
    is_embedded_image: true
  };
};

// 处理 content_references 引用替换
// ChatGPT 消息中的 citeturnXviewYturnZsearchW 等引用文本替换为 markdown 链接
const applyContentReferences = (text, metadata) => {
  if (!text || !metadata) return text;
  const refs = metadata.content_references;
  if (!Array.isArray(refs) || refs.length === 0) return text;

  let result = text;
  // 按 matched_text 长度降序排列，避免短匹配替换掉长匹配的一部分
  const sorted = refs
    .filter(ref => ref && ref.matched_text && ref.alt)
    .sort((a, b) => b.matched_text.length - a.matched_text.length);

  for (const ref of sorted) {
    result = result.split(ref.matched_text).join(ref.alt);
  }
  return result;
};

// ==================== ChatGPT 解析器 ====================

const REDACTED_PLACEHOLDERS = new Set([
  'The output of this plugin was redacted.'
]);

const cloneTool = tool => ({ ...tool });

const cloneTraversalState = state => ({
  pendingThinking: state.pendingThinking,
  pendingTools: state.pendingTools.map(cloneTool),
  pendingAttachments: [...state.pendingAttachments],
  pendingAssistantGeneratedImages: [...state.pendingAssistantGeneratedImages],
  lastUserMessage: state.lastUserMessage
});

const createTraversalState = () => ({
  pendingThinking: '',
  pendingTools: [],
  pendingAttachments: [],
  pendingAssistantGeneratedImages: [],
  lastUserMessage: null
});

const textFromPart = part => {
  if (typeof part === 'string') return part;
  if (!part || typeof part !== 'object') return '';
  if (typeof part.text === 'string') return part.text;
  if (typeof part.content === 'string') return part.content;
  if (typeof part.caption === 'string') return part.caption;
  return '';
};

const extractTextFromContent = content => {
  if (!content || typeof content !== 'object') return '';
  if (Array.isArray(content.parts)) {
    return content.parts.map(textFromPart).filter(Boolean).join('');
  }
  if (typeof content.content === 'string') return content.content;
  if (typeof content.text === 'string') return content.text;
  return '';
};

const pointerAttachmentFromPart = (part, index) => {
  if (!part || typeof part !== 'object') return null;
  const pointer = part.asset_pointer || part.file_id || part.url || part.location;
  const type = part.content_type || part.type || '';
  if (!pointer || !(
    type === 'image_asset_pointer' ||
    type === 'file' ||
    type === 'file_attachment' ||
    part.asset_pointer ||
    part.file_id
  )) {
    return null;
  }

  const mimeType = part.mime_type || part.file_type || part.format ||
    (type === 'image_asset_pointer' ? 'image/*' : 'application/octet-stream');
  const fileName = part.name || part.file_name ||
    (type === 'image_asset_pointer' ? `image_${index + 1}` : `attachment_${index + 1}`);

  return {
    id: String(pointer),
    file_name: fileName,
    file_size: Number(part.size || part.file_size || 0),
    file_type: mimeType,
    extracted_content: '',
    link: String(pointer),
    has_link: true,
    is_embedded_image: type === 'image_asset_pointer' || String(mimeType).startsWith('image/')
  };
};

const extractContentAttachments = content => {
  if (!content || !Array.isArray(content.parts)) return [];
  return content.parts
    .map(pointerAttachmentFromPart)
    .filter(Boolean);
};

const appendUniqueAttachments = (target, items) => {
  if (!Array.isArray(target) || !Array.isArray(items) || items.length === 0) return;
  const seen = new Set(target.map(item => [item?.id, item?.file_name, item?.link].join('|')));
  for (const item of items) {
    const key = [item?.id, item?.file_name, item?.link].join('|');
    if (!seen.has(key)) {
      seen.add(key);
      target.push(item);
    }
  }
};

const isTechnicalAssistantRecipient = recipient =>
  typeof recipient === 'string' && recipient.length > 0 && recipient !== 'all';

const shouldHideAssistantTextNode = (msg, metadata, rawText) => {
  const trimmed = (rawText || '').trim();
  if (metadata?.is_thinking_preamble_message === true) return true;
  if (isTechnicalAssistantRecipient(msg?.recipient)) return true;
  if (!trimmed && (!Array.isArray(metadata?.attachments) || metadata.attachments.length === 0)) return true;
  if (REDACTED_PLACEHOLDERS.has(trimmed)) return true;
  return false;
};

/**
 * 解析 ChatGPT 对话导出格式。
 * 可见消息只保留用户内容和真正的助手阅读内容；工具调用、推理节点和进度节点
 * 保留在 raw_data 或附着到对应助手回复上，不独占阅读卡片。
 */
export const extractChatGPTData = (jsonData, fileName = '') => {
  try {
    const mapping = jsonData.mapping || {};
    const title = jsonData.title || fileName.replace(/\.(jsonl|json)$/i, '') || 'ChatGPT 对话';
    const createdAt = jsonData.create_time
      ? DateTimeUtils.formatDateTime(new Date(jsonData.create_time * 1000).toISOString())
      : DateTimeUtils.formatDateTime(new Date().toISOString());

    const metaInfo = {
      title,
      created_at: createdAt,
      updated_at: jsonData.update_time
        ? DateTimeUtils.formatDateTime(new Date(jsonData.update_time * 1000).toISOString())
        : createdAt,
      project_uuid: '',
      uuid: jsonData.conversation_id || jsonData.id || '',
      model: jsonData.default_model_slug || '',
      platform: 'chatgpt',
      has_embedded_images: false,
      images_processed: 0
    };

    const chatHistory = [];
    let messageIndex = 0;
    const ROOT_UUID = PARSER_CONFIG.ROOT_UUID;
    const nodeIdToMessage = new Map();

    const findNearestMessageUuid = parentId => {
      let currentId = parentId;
      const visited = new Set();
      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        if (nodeIdToMessage.has(currentId)) return nodeIdToMessage.get(currentId).uuid;
        const parentNode = mapping[currentId];
        currentId = parentNode?.parent || null;
      }
      return '';
    };

    const rootNodeIds = [];
    for (const nodeId in mapping) {
      const node = mapping[nodeId];
      if (!node || !node.parent || !(node.parent in mapping)) rootNodeIds.push(nodeId);
    }

    const parseToolFromAssistant = msg => {
      const content = msg.content || {};
      const metadata = msg.metadata || {};
      const recipient = msg.recipient;
      const toolName = isTechnicalAssistantRecipient(recipient) ? recipient : null;

      if (Array.isArray(metadata.search_queries) && metadata.search_queries.length > 0) {
        return {
          name: toolName || 'search',
          input: metadata.search_queries.map(q => ({ q: q?.q || q })),
          result: null
        };
      }

      const text = extractTextFromContent(content);
      if (!text) return toolName ? { name: toolName, input: {}, result: null } : null;

      try {
        const parsed = JSON.parse(text);
        return {
          name: toolName || 'tool',
          input: parsed.search_query || parsed.query || parsed,
          result: null
        };
      } catch (_) {
        return {
          name: toolName || 'code',
          input: text,
          result: null
        };
      }
    };

    const attachLoominaryImages = (node, messageData, state, role) => {
      const groups = node?.loominary_images;
      if (!groups || typeof groups !== 'object') return;

      if (role === 'user') {
        if (Array.isArray(groups.user)) {
          messageData.attachments = messageData.attachments.filter(att => !att.is_embedded_image);
          groups.user.forEach((img, idx) => {
            const attachment = processLoominaryImage(img, idx, 'user_image');
            if (attachment) {
              appendUniqueAttachments(messageData.attachments, [attachment]);
              metaInfo.has_embedded_images = true;
              metaInfo.images_processed += 1;
            }
          });
        }
        if (Array.isArray(groups.assistant_generated)) {
          state.pendingAssistantGeneratedImages = [...groups.assistant_generated];
        }
        return;
      }

      if (role === 'assistant' && Array.isArray(groups.assistant)) {
        messageData.attachments = messageData.attachments.filter(att => !att.is_embedded_image);
        groups.assistant.forEach((img, idx) => {
          const attachment = processLoominaryImage(img, idx, 'assistant_image');
          if (attachment) {
            appendUniqueAttachments(messageData.attachments, [attachment]);
            metaInfo.has_embedded_images = true;
            metaInfo.images_processed += 1;
          }
        });
      }
    };

    const consumeGeneratedImages = (messageData, state) => {
      if (state.pendingAssistantGeneratedImages.length === 0) return;
      state.pendingAssistantGeneratedImages.forEach((img, idx) => {
        const attachment = processLoominaryImage(img, idx, 'generated');
        if (attachment) {
          appendUniqueAttachments(messageData.attachments, [attachment]);
          metaInfo.has_embedded_images = true;
          metaInfo.images_processed += 1;
        }
      });
      state.pendingAssistantGeneratedImages = [];
    };

    const processToolResult = (msg, state) => {
      const metadata = msg.metadata || {};
      const groups = metadata.search_result_groups;
      const resultObj = {};

      if (Array.isArray(groups)) {
        const domainMap = {};
        groups.forEach(group => {
          const entries = Array.isArray(group?.entries) ? group.entries : [];
          entries.forEach(entry => {
            const url = entry?.url || '';
            let domain = String(group?.domain || '').trim();
            if (!domain && typeof url === 'string') {
              const match = url.match(/^(?:https?:\/\/)?([^/]+)/i);
              domain = match?.[1] || '';
            }
            if (!domainMap[domain]) domainMap[domain] = [];
            domainMap[domain].push({
              url,
              title: entry?.title || '',
              snippet: entry?.snippet || '',
              pub_date: entry?.pub_date || null,
              attribution: entry?.attribution || ''
            });
          });
        });
        resultObj.groups = Object.keys(domainMap).map(domain => ({
          domain,
          entries: domainMap[domain]
        }));
      }

      if (Array.isArray(metadata?.search_model_queries?.queries)) {
        resultObj.queries = metadata.search_model_queries.queries.map(q => q?.q || q);
      }

      const contentText = extractTextFromContent(msg.content || {});
      if (contentText) resultObj.text = contentText;

      if (state.pendingTools.length > 0) {
        state.pendingTools[state.pendingTools.length - 1].result =
          Object.keys(resultObj).length > 0 ? resultObj : (msg.content || {});
      } else {
        state.pendingTools.push({
          name: msg.author?.name || 'tool',
          input: {},
          result: Object.keys(resultObj).length > 0 ? resultObj : (msg.content || {})
        });
      }

      if (Array.isArray(metadata.attachments)) {
        appendUniqueAttachments(state.pendingAttachments, processAttachments(metadata.attachments));
      }
    };

    const traverse = (nodeId, incomingState) => {
      const node = mapping[nodeId];
      if (!node) return;

      const state = cloneTraversalState(incomingState);
      const msg = node.message;

      if (msg) {
        const author = msg.author || {};
        const role = author.role;
        const metadata = msg.metadata || {};

        if (!metadata.is_visually_hidden_from_conversation) {
          if (role === 'system') {
            if (Array.isArray(metadata.attachments) && state.lastUserMessage) {
              appendUniqueAttachments(
                state.lastUserMessage.attachments,
                processAttachments(metadata.attachments)
              );
            }
          } else if (role === 'user') {
            state.pendingThinking = '';
            state.pendingTools = [];
            state.pendingAttachments = [];
            state.pendingAssistantGeneratedImages = [];

            const uuid = msg.id || nodeId;
            let parentUuid = findNearestMessageUuid(node.parent);
            if (!parentUuid) parentUuid = ROOT_UUID;
            const timestamp = msg.create_time
              ? DateTimeUtils.formatDateTime(new Date(msg.create_time * 1000).toISOString())
              : '';
            const content = msg.content || {};
            let rawText = applyContentReferences(extractTextFromContent(content), metadata);

            const messageData = new MessageBuilder(
              messageIndex++,
              uuid,
              parentUuid,
              'human',
              'User',
              timestamp
            )
              .setContent(rawText)
              .addCitations(metadata)
              .addAttachments(metadata)
              .finalize(true);

            messageData._node_id = nodeId;
            appendUniqueAttachments(messageData.attachments, extractContentAttachments(content));
            attachLoominaryImages(node, messageData, state, 'user');

            chatHistory.push(messageData);
            nodeIdToMessage.set(nodeId, messageData);
            state.lastUserMessage = messageData;
          } else if (role === 'assistant') {
            const content = msg.content || {};
            const contentType = content.content_type || '';

            if (contentType === 'model_editable_context') {
              state.pendingThinking = '';
              state.pendingTools = [];
              state.pendingAttachments = [];
            } else if (contentType === 'thoughts' && Array.isArray(content.thoughts)) {
              const joined = content.thoughts
                .map(thought => [thought?.summary, thought?.content].filter(Boolean).join('\n').trim())
                .filter(Boolean)
                .join('\n\n');
              if (joined) {
                state.pendingThinking = state.pendingThinking
                  ? `${state.pendingThinking}\n\n${joined}`
                  : joined;
              }
            } else if (contentType === 'reasoning_recap') {
              // raw_data retains the recap. It is progress metadata, not a standalone reader message.
            } else if (
              contentType === 'code' ||
              isTechnicalAssistantRecipient(msg.recipient)
            ) {
              const tool = parseToolFromAssistant(msg);
              if (tool) state.pendingTools.push(tool);
              if (Array.isArray(metadata.attachments)) {
                appendUniqueAttachments(state.pendingAttachments, processAttachments(metadata.attachments));
              }
            } else if (
              contentType === 'tether_browsing_search_result' ||
              contentType === 'tool_result' ||
              contentType === 'execution_output'
            ) {
              processToolResult(msg, state);
            } else {
              const rawText = applyContentReferences(extractTextFromContent(content), metadata);
              const contentAttachments = extractContentAttachments(content);

              if (!shouldHideAssistantTextNode(msg, metadata, rawText) || contentAttachments.length > 0) {
                const uuid = msg.id || nodeId;
                let parentUuid = findNearestMessageUuid(node.parent);
                if (!parentUuid) parentUuid = ROOT_UUID;
                const timestamp = msg.create_time
                  ? DateTimeUtils.formatDateTime(new Date(msg.create_time * 1000).toISOString())
                  : '';

                const messageData = new MessageBuilder(
                  messageIndex++,
                  uuid,
                  parentUuid,
                  'assistant',
                  'ChatGPT',
                  timestamp
                )
                  .setContent(rawText)
                  .setThinking(state.pendingThinking)
                  .addCitations(metadata)
                  .addAttachments(metadata)
                  .addTools(state.pendingTools.map(cloneTool))
                  .finalize(false);

                messageData._node_id = nodeId;
                appendUniqueAttachments(messageData.attachments, contentAttachments);
                appendUniqueAttachments(messageData.attachments, state.pendingAttachments);
                state.pendingAttachments = [];
                consumeGeneratedImages(messageData, state);
                attachLoominaryImages(node, messageData, state, 'assistant');

                chatHistory.push(messageData);
                nodeIdToMessage.set(nodeId, messageData);
              }
            }
          } else if (role === 'tool') {
            processToolResult(msg, state);
          }
        }
      }

      if (Array.isArray(node.children)) {
        node.children.forEach(childId => traverse(childId, state));
      }
    };

    rootNodeIds.forEach(rootId => traverse(rootId, createTraversalState()));

    return {
      meta_info: metaInfo,
      chat_history: chatHistory,
      raw_data: jsonData,
      format: 'chatgpt',
      platform: 'chatgpt'
    };
  } catch (error) {
    console.error('[ChatGPT Parser] 解析数据出错:', error);
    throw error;
  }
};

// ==================== ChatGPT 分支检测 ====================
// 根据 ChatGPT 导出的 mapping 结构和当前节点，标记分支信息。
// ChatGPT 的 mapping 中每个节点可能有多个子节点，表示回复分支。
export const detectChatGPTBranches = (processedData) => {
  /**
   * 自定义的 ChatGPT 分支检测：
   * 使用消息级的父子关系来识别分支点，而不是使用原始 mapping 中的每个节点。
   * 这样可以确保跳过的系统节点或上下文节点不会干扰分支标记，并能正确地把用户消息作为分支点。
   */
  if (!processedData || processedData.format !== 'chatgpt' || !processedData.chat_history) {
    return processedData;
  }
  const messages = processedData.chat_history;
  const rawData = processedData.raw_data || {};
  const mapping = rawData.mapping || {};
  const currentNode = rawData.current_node;

  // 构建 nodeId -> messageData 映射，只包括我们生成的消息
  const nodeIdToMessage = new Map();
  messages.forEach(msg => {
    if (msg._node_id) {
      nodeIdToMessage.set(msg._node_id, msg);
    }
  });

  // 计算主路径上的 nodeId 集合（从 currentNode 向上到根）
  const mainPathSet = new Set();
  let curr = currentNode;
  while (curr) {
    mainPathSet.add(curr);
    const parent = mapping[curr] ? mapping[curr].parent : null;
    if (!parent) break;
    curr = parent;
  }

  // 清理旧的 branch 标记，并把 raw current_node 映射到可见消息。
  messages.forEach(msg => {
    msg.is_branch_point = false;
    msg.branch_id = null;
    msg.branch_level = 0;
    msg._is_current_path = !!(msg._node_id && mainPathSet.has(msg._node_id));
  });

  // 构建消息级的 parent-child 映射
  const { parentChildMap, messageMap } = buildMessageMaps(messages);

  // 标记消息级的分支点：具有多个子消息的人类消息
  parentChildMap.forEach((children, parentUuid) => {
    if (children.length > 1) {
      const parentMsg = messageMap.get(parentUuid);
      if (parentMsg) parentMsg.is_branch_point = parentMsg.sender === 'human';
    }
  });

  // 找出根消息：没有 parent_uuid 或 parent_uuid 不在消息映射中的消息
  const rootMessages = [];
  messages.forEach(msg => {
    const parentUuid = msg.parent_uuid;
    if (!parentUuid || !messageMap.has(parentUuid)) {
      rootMessages.push(msg);
    }
  });

  // 按消息出现顺序排序根消息（保持时间顺序）
  rootMessages.sort((a, b) => a.index - b.index);

  // 辅助函数：递归分配 branch_id 和 branch_level
  const visited = new Set();
  function assign(msg, branchPath, level) {
    if (!msg || visited.has(msg.uuid)) return;
    visited.add(msg.uuid);
    msg.branch_id = branchPath;
    msg.branch_level = level;
    const children = parentChildMap.get(msg.uuid) || [];
    if (children.length === 0) return;
    // 选择主路径子消息：_node_id 在主路径集合中的消息优先
    let mainChildUuid = null;
    for (const childUuid of children) {
      const childMsg = messageMap.get(childUuid);
      if (childMsg && childMsg._node_id && mainPathSet.has(childMsg._node_id)) {
        mainChildUuid = childUuid;
        break;
      }
    }
    if (!mainChildUuid && children.length > 0) {
      mainChildUuid = children[0];
    }
    // 为每个子消息分配分支路径
    let altIndex = 1;
    for (const childUuid of children) {
      const childMsg = messageMap.get(childUuid);
      if (!childMsg) continue;
      if (childUuid === mainChildUuid) {
        assign(childMsg, branchPath, level);
      } else {
        const childPath = branchPath ? `${branchPath}.${altIndex}` : `${altIndex}`;
        assign(childMsg, childPath, level + 1);
        altIndex++;
      }
    }
  }

  // 为根消息分配分支路径。raw current_node 所在的根分支优先作为 main；
  // 缺少 current_node 时才退回原有的消息顺序。
  const currentRoot = rootMessages.find(msg => msg._is_current_path) || null;
  const orderedRoots = currentRoot
    ? [currentRoot, ...rootMessages.filter(msg => msg !== currentRoot)]
    : rootMessages;

  orderedRoots.forEach((rootMsg, idx) => {
    const branchPath = idx === 0 ? 'main' : `main.${idx}`;
    const level = idx === 0 ? 0 : 1;
    assign(rootMsg, branchPath, level);
  });

  return processedData;
};
