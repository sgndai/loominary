import { exportConversationJson } from './jsonExporter.mjs';
import { exportConversationMarkdown } from './markdownExporter.mjs';

function safeFileName(value) {
  return String(value || 'conversation')
    .replace(/[^a-zA-Z0-9-_]+/g, '_')
    .slice(0, 80);
}

function collectFiles(record) {
  const files = [];
  for (const message of record.messages || []) {
    for (const attachment of message.attachments || []) {
      files.push({
        id: attachment.id,
        name: attachment.name || attachment.id,
        mimeType: attachment.mimeType || 'application/octet-stream',
        source: attachment.source || null,
        url: attachment.location || null
      });
    }
  }
  return files;
}

export function exportConversationBundle(record, options = {}) {
  const title = safeFileName(record.conversation?.title);
  const files = collectFiles(record);

  const manifest = {
    schemaVersion: 'loominary.bundle/v1',
    conversationId: record.conversation.id,
    createdAt: options.createdAt || null,
    files,
    exports: [
      'conversation.json',
      'conversation.md',
      'ai.md',
      'manifest.json'
    ]
  };

  const aiMarkdown = exportConversationMarkdown(record, {
    includeThinking: false,
    includeToolCalls: false
  });

  return {
    filename: `${title}.zip`,
    entries: {
      'conversation.json': exportConversationJson(record),
      'conversation.md': exportConversationMarkdown(record),
      'ai.md': aiMarkdown,
      'manifest.json': JSON.stringify(manifest, null, 2)
    }
  };
}
