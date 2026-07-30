function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function firstString(...values) {
  return values.find(value => typeof value === 'string' && value.length > 0) || null;
}

function buildRequestHeaders(token) {
  const headers = {
    Authorization: `Bearer ${token}`
  };

  if (typeof ChatGPTHandler !== 'undefined' && typeof ChatGPTHandler.getOaiDeviceId === 'function') {
    const deviceId = ChatGPTHandler.getOaiDeviceId();
    if (deviceId) headers['oai-device-id'] = deviceId;
  }

  if (
    typeof State !== 'undefined' &&
    State.chatgptWorkspaceType === 'team' &&
    State.chatgptWorkspaceId
  ) {
    headers['ChatGPT-Account-Id'] = State.chatgptWorkspaceId;
  }

  return headers;
}

function fileIdFromPointer(value) {
  if (typeof value !== 'string' || !value) return null;
  const decoded = value.replace(/^file-service:\/\//, '').replace(/^sediment:\/\//, '');
  const segments = decoded.split('#');
  return segments.find(segment => /^file[-_][A-Za-z0-9_-]+$/.test(segment)) ||
    (/^file[-_][A-Za-z0-9_-]+$/.test(decoded) ? decoded : null);
}

function normalizeReference(item, nodeId, messageId, index) {
  if (!isObject(item)) return null;

  const fileId = firstString(
    item.file_id,
    item.library_file_id,
    fileIdFromPointer(item.asset_pointer),
    /^file[-_]/.test(item.id || '') ? item.id : null
  );
  if (!fileId) return null;

  return {
    key: `${messageId || nodeId}:${fileId}`,
    nodeId,
    messageId,
    fileId,
    name: firstString(item.name, item.file_name, item.filename) || fileId,
    mimeType: firstString(item.mime_type, item.mimeType, item.file_type, item.media_type),
    size: Number(item.size ?? item.size_bytes ?? item.file_size ?? 0) || 0,
    source: firstString(item.source) || 'chatgpt',
    index
  };
}

export function collectChatgptAttachmentReferences(rawConversation) {
  const mapping = isObject(rawConversation?.mapping) ? rawConversation.mapping : {};
  const references = [];
  const byFileId = new Map();

  for (const [nodeId, node] of Object.entries(mapping)) {
    const message = isObject(node?.message) ? node.message : null;
    if (!message) continue;

    const messageId = firstString(message.id) || nodeId;
    const metadata = isObject(message.metadata) ? message.metadata : {};
    const candidates = [];

    if (Array.isArray(metadata.attachments)) candidates.push(...metadata.attachments);
    if (isObject(message.content) && Array.isArray(message.content.parts)) {
      candidates.push(...message.content.parts.filter(isObject));
    }

    candidates.forEach((candidate, index) => {
      const reference = normalizeReference(candidate, nodeId, messageId, index);
      if (!reference) return;

      const existing = byFileId.get(reference.fileId);
      if (existing) {
        existing.name = existing.name === existing.fileId ? reference.name : existing.name;
        existing.mimeType = existing.mimeType || reference.mimeType;
        existing.size = existing.size || reference.size;
        return;
      }

      byFileId.set(reference.fileId, reference);
      references.push(reference);
    });
  }

  return references;
}

async function fetchSignedDownloadUrl(reference, conversationId, headers) {
  const endpoint = `/backend-api/files/download/${encodeURIComponent(reference.fileId)}?conversation_id=${encodeURIComponent(conversationId)}`;
  const response = await fetch(endpoint, { headers });
  if (!response.ok) {
    throw new Error(`files/download returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const url = firstString(data.download_url, data.url);
  if (!url) throw new Error('files/download returned no download URL');
  return url;
}

async function downloadReference(reference, conversationId, token) {
  const headers = buildRequestHeaders(token);
  let primaryError = null;

  try {
    const signedUrl = await fetchSignedDownloadUrl(reference, conversationId, headers);
    const blob = await fetchViaGM(signedUrl);
    return { blob, originalSrc: signedUrl };
  } catch (error) {
    primaryError = error;
  }

  try {
    const fallbackUrl = `${location.origin}/backend-api/estuary/content?id=${encodeURIComponent(reference.fileId)}`;
    const blob = await fetchViaGM(fallbackUrl, headers);
    return { blob, originalSrc: fallbackUrl };
  } catch (fallbackError) {
    throw new Error(`${primaryError?.message || 'files/download failed'}; estuary fallback failed: ${fallbackError.message}`);
  }
}

function hasDownloadedFile(node, fileId) {
  const groups = isObject(node?.loominary_attachments) ? node.loominary_attachments : {};
  return Object.values(groups).some(values =>
    Array.isArray(values) && values.some(item => item?.id === fileId && item?.data)
  );
}

function injectDownloadedFile(rawConversation, reference, payload) {
  const node = rawConversation.mapping?.[reference.nodeId];
  if (!node || hasDownloadedFile(node, reference.fileId)) return;

  if (!isObject(node.loominary_attachments)) node.loominary_attachments = {};
  if (!Array.isArray(node.loominary_attachments.downloaded)) {
    node.loominary_attachments.downloaded = [];
  }

  node.loominary_attachments.downloaded.push({
    id: reference.fileId,
    file_id: reference.fileId,
    name: reference.name,
    file_name: reference.name,
    format: payload.mimeType || reference.mimeType || 'application/octet-stream',
    mime_type: payload.mimeType || reference.mimeType || 'application/octet-stream',
    size: payload.size,
    data: payload.data,
    source: reference.source,
    original_src: payload.originalSrc
  });
}

export async function collectCurrentChatgptArchiveInput(options = {}) {
  if (typeof ChatGPTHandler === 'undefined') {
    throw new Error('ChatGPT handler is unavailable');
  }

  const conversationId = options.conversationId || ChatGPTHandler.getCurrentConversationId();
  if (!conversationId) throw new Error('Current ChatGPT conversation ID was not found');

  const token = await ChatGPTHandler.ensureAccessToken();
  if (!token) throw new Error('ChatGPT access token was not found');

  const rawConversation = await ChatGPTHandler.getConversation(conversationId, options.includeImages !== false);
  const references = collectChatgptAttachmentReferences(rawConversation);
  const failures = [];
  let downloaded = 0;

  for (const reference of references) {
    try {
      const result = await downloadReference(reference, conversationId, token);
      const data = await Utils.blobToBase64(result.blob);
      injectDownloadedFile(rawConversation, reference, {
        data,
        size: result.blob.size,
        mimeType: result.blob.type || reference.mimeType,
        originalSrc: result.originalSrc
      });
      downloaded += 1;
    } catch (error) {
      failures.push({
        messageId: reference.messageId,
        fileId: reference.fileId,
        name: reference.name,
        reason: error.message || String(error)
      });
    }
  }

  rawConversation.loominary_asset_report = {
    expected: references.length,
    downloaded,
    failed: failures.length,
    failures
  };

  return {
    rawConversation,
    assetReport: rawConversation.loominary_asset_report
  };
}
