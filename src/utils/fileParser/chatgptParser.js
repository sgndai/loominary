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

const REDACTED_PLACEHOLDERS = new Set([
  'The output of this plugin was redacted.'
]);

const extractPartText = (part) => {
  if (typeof part === 'string') return part;
  if (!part || typeof part !== 'object') return '';
  if (typeof part.text === 'string') return part.text;
  if (typeof part.content === 'string') return part.content;
  return '';
};

const extractContentText = (content = {}) => {
  if (Array.isArray(content.parts)) {
    return content.parts.map(extractPartText).filter(Boolean).join('');
  }
  if (typeof content.content === 'string') return content.content;
  if (typeof content.text === 'string') return content.text;
  return '';
};

const isAssistantTechnicalNode = (msg, rawText) => {
  const content = msg.content || {};
  const contentType = content.content_type || '';
  const metadata = msg.metadata || {};
  const recipient = msg.recipient;

  if (metadata.is_thinking_preamble_message === true) return true;
  if (msg.channel === 'commentary') return true;
  if (recipient && recipient !== 'all') return true;
  if ([
    'model_editable_context',
    'thoughts',
    'reasoning_recap',
    'code',
    'tether_browsing_search_result',
    'tool_result',
    'execution_output'
  ].includes(contentType)) return true;
  if (REDACTED_PLACEHOLDERS.has(String(rawText || '').trim())) return true;
  return false;
};

const cloneTraversalState = (state) => ({
  pendingThinking: state.pendingThinking,
  pendingTools: state.pendingTools.map(tool => ({ ...tool })),
  pendingRecap: state.pendingRecap,
  pendingAttachments: [...state.pendingAttachments],
  pendingAssistantGeneratedImages: [...state.pendingAssistantGeneratedImages],
  lastUserMessage: state.lastUserMessage
});

const createTraversalState = () => ({
  pendingThinking: '',
  pendingTools: [],
  pendingRecap: '',
  pendingAttachments: [],
  pendingAssistantGeneratedImages: [],
  lastUserMessage: null
});

// ==================== ChatGPT 解析器 ====================
/**
 * 解析 ChatGPT 对话导出格式
 * ChatGPT 导出包含 mapping 字典，每个节点包含 message 数据以及父子关系。
 * @param {Object} jsonData - ChatGPT 导出的原始 JSON
 * @param {String} fileName - 文件名，用于默认标题
 */
export const extractChatGPTData = (jsonData, fileName = '') => {
  try {
    const mapping = jsonData.mapping || {};
    const title = jsonData.title || fileName.replace(/\.(jsonl|json)$/i, '') || 'ChatGPT 对话';
    const createdAt = jsonData.create_time ? DateTimeUtils.formatDateTime(new Date(jsonData.create_time * 1000).toISOString()) : DateTimeUtils.formatDateTime(new Date().toISOString());

    const metaInfo = {
      title,
      created_at: createdAt,
      updated_at: jsonData.update_time ? DateTimeUtils.formatDateTime(new Date(jsonData.update_time * 1000).toISOString()) : createdAt,
      project_uuid: '',
      uuid: jsonData.conversation_id || jsonData.id || '',
      model: jsonData.default_model_slug || '',
      platform: 'chatgpt',
      has_embedded_images: false,
      images_processed: 0
    };

    const chatHistory = [];
    let messageIndex = 0;

    // 定义一个统一的根UUID，用于挂接首轮分支的根节点
    const ROOT_UUID = PARSER_CONFIG.ROOT_UUID;

    // 保存 nodeId 到消息对象的映射，便于设置 parent_uuid
    const nodeIdToMessage = new Map();

    /**
     * 寻找某节点祖先链上最近的已生成消息，用于确定 parent_uuid
     * @param {string} parentId - 当前节点的父 nodeId
     * @returns {string} 消息的 uuid，如果不存在则返回空字符串
     */
    const findNearestMessageUuid = (parentId) => {
      let currentId = parentId;
      while (currentId) {
        if (nodeIdToMessage.has(currentId)) {
          return nodeIdToMessage.get(currentId).uuid;
        }
        const parentNode = mapping[currentId];
        currentId = parentNode && parentNode.parent ? parentNode.parent : null;
      }
      return '';
    };

    // 找出所有根节点（没有 parent 或 parent 不存在于 mapping 中）
    const rootNodeIds = [];
    for (const nodeId in mapping) {
      const node = mapping[nodeId];
      if (!node || !node.parent || !(node.parent in mapping)) {
        rootNodeIds.push(nodeId);
      }
    }

    /**
     * 解析助手的 "code" 类消息，将其转换为工具调用对象
     * @param {object} msg - 节点的 message 对象
     * @returns {object|null} 工具调用对象，或 null
     */
    const parseToolFromCode = (msg) => {
      const content = msg.content || {};
      // 尝试从 metadata.search_queries 或 content.text 中提取
      const metadata = msg.metadata || {};
      if (metadata.search_queries && Array.isArray(metadata.search_queries) && metadata.search_queries.length > 0) {
        return {
          name: 'search',
          input: metadata.search_queries.map(q => ({ q: q.q || q })),
          result: null
        };
      }
      const text = content.text || (Array.isArray(content.parts) ? content.parts.join('') : '');
      if (text) {
        try {
          const obj = JSON.parse(text);
          return {
            name: 'search',
            input: obj.search_query || obj.query || obj,
            result: null
          };
        } catch (e) {
          return {
            name: 'code',
            input: text,
            result: null
          };
        }
      }
      return null;
    };

    // 递归遍历节点，深度优先。每个 raw 分支拥有独立的解析状态，
    // 防止 retry/edit 分支之间串入 thinking、tool、attachment 等数据。
    const traverse = (nodeId, incomingState) => {
      const node = mapping[nodeId];
      if (!node) return;

      const state = cloneTraversalState(incomingState);
      const msg = node.message;

      // 当 message 存在时才处理消息内容，但无论如何都要遍历子节点
      if (msg) {
        const author = msg.author || {};
        const role = author.role;
        const metadata = msg.metadata || {};

        // 如果该消息被标记为对话中隐藏，则跳过对话解析，但仍需沿当前 raw 路径继续。
        if (!metadata.is_visually_hidden_from_conversation) {
          if (role === 'system') {
            if (Array.isArray(metadata.attachments) && state.lastUserMessage) {
              processAttachments(metadata.attachments).forEach(att => {
                state.lastUserMessage.attachments.push(att);
              });
            }
          } else if (role === 'user') {
            // 新一轮用户消息开始，assistant 辅助状态全部清空。
            state.pendingThinking = '';
            state.pendingTools = [];
            state.pendingRecap = '';
            state.pendingAttachments = [];
            state.pendingAssistantGeneratedImages = [];

            const uuid = msg.id || nodeId;
            let parentUuid = findNearestMessageUuid(node.parent);
            if (!parentUuid) parentUuid = ROOT_UUID;
            const timestamp = msg.create_time
              ? DateTimeUtils.formatDateTime(new Date(msg.create_time * 1000).toISOString())
              : '';

            let rawText = extractContentText(msg.content || {});
            rawText = applyContentReferences(rawText, metadata);

            const messageData = new MessageBuilder(messageIndex++, uuid, parentUuid, 'human', 'User', timestamp)
              .setContent(rawText)
              .addCitations(metadata)
              .addAttachments(metadata)
              .finalize(true);

            messageData._node_id = nodeId;

            if (node.loominary_images) {
              if (Array.isArray(node.loominary_images.user)) {
                messageData.attachments = messageData.attachments.filter(att => !att.is_embedded_image);
                node.loominary_images.user.forEach((img, idx) => {
                  const attachment = processLoominaryImage(img, idx, 'user_image');
                  if (attachment) {
                    messageData.attachments.push(attachment);
                    metaInfo.has_embedded_images = true;
                    metaInfo.images_processed = (metaInfo.images_processed || 0) + 1;
                  }
                });
              }
              if (Array.isArray(node.loominary_images.assistant_generated)) {
                state.pendingAssistantGeneratedImages = [...node.loominary_images.assistant_generated];
              }
            }

            chatHistory.push(messageData);
            nodeIdToMessage.set(nodeId, messageData);
            state.lastUserMessage = messageData;
          } else if (role === 'assistant') {
            const content = msg.content || {};
            const contentType = content.content_type || '';

            if (contentType === 'model_editable_context') {
              state.pendingThinking = '';
              state.pendingTools = [];
              state.pendingRecap = '';
              state.pendingAttachments = [];
            } else if (contentType === 'thoughts' && Array.isArray(content.thoughts)) {
              const joined = content.thoughts.map(th => {
                let value = '';
                if (th?.summary) value += th.summary + '\n';
                if (th?.content) value += th.content;
                return value.trim();
              }).filter(Boolean).join('\n\n');
              if (joined) {
                state.pendingThinking = state.pendingThinking
                  ? state.pendingThinking + '\n\n' + joined
                  : joined;
              }
            } else if (contentType === 'code') {
              const tool = parseToolFromCode(msg);
              if (tool) state.pendingTools.push(tool);
            } else if (contentType === 'tether_browsing_search_result' || contentType === 'tool_result') {
              const resultObj = typeof content === 'object' ? content : {};
              if (state.pendingTools.length > 0) {
                state.pendingTools[state.pendingTools.length - 1].result = resultObj;
              } else {
                state.pendingTools.push({ name: 'tool', input: {}, result: resultObj });
              }
            } else if (contentType === 'reasoning_recap') {
              state.pendingRecap = extractContentText(content).trim();
            } else {
              let rawText = extractContentText(content);
              let imageAttachment = null;

              if (contentType === 'image_file') {
                const fileId = content.file_id || content.fileID || '';
                const fileName = content.name || content.file_name || 'image';
                imageAttachment = {
                  id: fileId,
                  file_name: fileName,
                  file_size: content.size || 0,
                  file_type: content.mimeType || 'image/png',
                  extracted_content: '',
                  link: fileId || '',
                  has_link: !!fileId
                };
                if (!rawText) rawText = `[图片: ${fileName}]`;
              }

              rawText = applyContentReferences(rawText, metadata);
              const hasRenderablePayload = !!(
                rawText.trim() ||
                imageAttachment ||
                (Array.isArray(metadata.attachments) && metadata.attachments.length > 0) ||
                (node.loominary_images && Array.isArray(node.loominary_images.assistant) && node.loominary_images.assistant.length > 0)
              );

              if (!isAssistantTechnicalNode(msg, rawText) && hasRenderablePayload) {
                const uuid = msg.id || nodeId;
                let parentUuid = findNearestMessageUuid(node.parent);
                if (!parentUuid) parentUuid = ROOT_UUID;
                const timestamp = msg.create_time
                  ? DateTimeUtils.formatDateTime(new Date(msg.create_time * 1000).toISOString())
                  : '';

                const messageData = new MessageBuilder(messageIndex++, uuid, parentUuid, 'assistant', 'ChatGPT', timestamp)
                  .setContent(rawText)
                  .setThinking(state.pendingThinking)
                  .addCitations(metadata)
                  .addAttachments(metadata)
                  .addTools(state.pendingTools.map(tool => ({ ...tool })))
                  .finalize(false);

                messageData._node_id = nodeId;
                if (state.pendingRecap) messageData.reasoning_recap = state.pendingRecap;
                if (imageAttachment) messageData.attachments.unshift(imageAttachment);
                if (state.pendingAttachments.length > 0) {
                  messageData.attachments.push(...state.pendingAttachments);
                }

                if (state.pendingAssistantGeneratedImages.length > 0) {
                  state.pendingAssistantGeneratedImages.forEach((img, idx) => {
                    const attachment = processLoominaryImage(img, idx, 'generated');
                    if (attachment) {
                      messageData.attachments.push(attachment);
                      metaInfo.has_embedded_images = true;
                      metaInfo.images_processed = (metaInfo.images_processed || 0) + 1;
                    }
                  });
                }

                if (node.loominary_images && Array.isArray(node.loominary_images.assistant)) {
                  messageData.attachments = messageData.attachments.filter(att => !att.is_embedded_image);
                  node.loominary_images.assistant.forEach((img, idx) => {
                    const attachment = processLoominaryImage(img, idx, 'assistant_image');
                    if (attachment) {
                      messageData.attachments.push(attachment);
                      metaInfo.has_embedded_images = true;
                      metaInfo.images_processed = (metaInfo.images_processed || 0) + 1;
                    }
                  });
                }

                chatHistory.push(messageData);
                nodeIdToMessage.set(nodeId, messageData);

                // 已消费的 assistant 辅助状态不能继续泄漏到后续消息。
                state.pendingThinking = '';
                state.pendingTools = [];
                state.pendingRecap = '';
                state.pendingAttachments = [];
                state.pendingAssistantGeneratedImages = [];
              }
            }
          } else if (role === 'tool') {
            const toolName = author.name || '';
            const groups = metadata?.search_result_groups;
            if (Array.isArray(groups)) {
              const domainMap = {};
              groups.forEach(grp => {
                const entries = Array.isArray(grp.entries) ? grp.entries : [];
                if (grp && grp.domain && String(grp.domain).trim()) {
                  const dom = String(grp.domain).trim();
                  if (!domainMap[dom]) domainMap[dom] = [];
                  entries.forEach(entry => {
                    domainMap[dom].push({
                      url: entry.url || '',
                      title: entry.title || '',
                      snippet: entry.snippet || '',
                      pub_date: entry.pub_date || null,
                      attribution: entry.attribution || ''
                    });
                  });
                } else {
                  entries.forEach(entry => {
                    const url = entry.url || '';
                    let dom = '';
                    const match = typeof url === 'string' && url.match(/^(?:https?:\/\/)?([^/]+)/i);
                    if (match) dom = match[1] || '';
                    if (!domainMap[dom]) domainMap[dom] = [];
                    domainMap[dom].push({
                      url: entry.url || '',
                      title: entry.title || '',
                      snippet: entry.snippet || '',
                      pub_date: entry.pub_date || null,
                      attribution: entry.attribution || ''
                    });
                  });
                }
              });

              const mappedGroups = Object.keys(domainMap).map(dom => ({
                domain: dom || '',
                entries: domainMap[dom]
              }));
              let queries = [];
              if (metadata?.search_model_queries && Array.isArray(metadata.search_model_queries.queries)) {
                queries = metadata.search_model_queries.queries.map(q => q.q || q);
              }

              if (state.pendingTools.length > 0) {
                const lastTool = state.pendingTools[state.pendingTools.length - 1];
                lastTool.result = lastTool.result || {};
                lastTool.result.groups = mappedGroups;
                if (queries.length > 0) lastTool.result.queries = queries;
              } else {
                const resultObj = { groups: mappedGroups };
                if (queries.length > 0) resultObj.queries = queries;
                state.pendingTools.push({ name: toolName || 'tool', input: {}, result: resultObj });
              }
            }

            if (Array.isArray(metadata?.attachments)) {
              state.pendingAttachments.push(...processAttachments(metadata.attachments));
            }
          }
        }
      }

      if (node.children && Array.isArray(node.children)) {
        node.children.forEach(childId => traverse(childId, state));
      }
    };

    // 按根节点顺序遍历
    rootNodeIds.forEach(rootId => {
      traverse(rootId, createTraversalState());
    });

    const processed = {
      meta_info: metaInfo,
      chat_history: chatHistory,
      raw_data: jsonData,
      format: 'chatgpt',
      platform: 'chatgpt'
    };

    return processed;
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
