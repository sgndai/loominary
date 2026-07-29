import { validateConversationRecord } from '../../../server/archive/contract.mjs';

function escapeMarkdownLabel(value) {
  return String(value || '').replace(/[\[\]]/g, '\\$&');
}

function safeLink(location) {
  if (typeof location !== 'string' || !location.trim()) return null;
  if (/^data:/i.test(location)) return null;
  return location.trim();
}

function formatCitation(citation) {
  if (!citation) return '';
  const title = escapeMarkdownLabel(citation.title || citation.url || 'Source');
  const url = safeLink(citation.url);
  return url ? `- [${title}](${url})` : `- ${title}`;
}

function formatAttachment(attachment) {
  const name = escapeMarkdownLabel(attachment?.name || attachment?.id || 'Attachment');
  const location = safeLink(attachment?.location);
  const mimeType = attachment?.mimeType ? ` (${attachment.mimeType})` : '';
  return location ? `- [${name}](${location})${mimeType}` : `- ${name}${mimeType}`;
}

function branchSuffix(message, options) {
  if (options.includeBranchMarkers === false || !message.branchId || message.branchId === 'main') return '';
  return ` · branch ${message.branchId}`;
}

function formatMessage(message, index, options) {
  const role = message.role || 'unknown';
  const lines = [`## ${index + 1}. ${role}${branchSuffix(message, options)}`];

  if (options.includeTimestamps !== false && message.createdAt) {
    lines.push(`_${message.createdAt}_`);
  }

  lines.push('', message.text || '');

  if (options.includeThinking !== false && message.thinking) {
    lines.push('', '<details>', '<summary>Thinking</summary>', '', message.thinking, '', '</details>');
  }

  if (options.includeCitations !== false && message.citations?.length) {
    lines.push('', '### Citations');
    lines.push(...message.citations.map(formatCitation).filter(Boolean));
  }

  if (options.includeAttachments !== false && message.attachments?.length) {
    lines.push('', '### Attachments');
    lines.push(...message.attachments.map(formatAttachment));
  }

  if (options.includeToolCalls !== false && message.toolCalls?.length) {
    lines.push('', '### Tool Calls');
    for (const tool of message.toolCalls) {
      lines.push(`- ${escapeMarkdownLabel(tool.name || 'unknown_tool')}`);
    }
  }

  return lines.join('\n');
}

export function exportConversationMarkdown(record, options = {}) {
  validateConversationRecord(record);

  const lines = [
    `# ${record.conversation.title}`,
    '',
    `Platform: ${record.conversation.platform}`,
    '',
    '---',
    ''
  ];

  record.messages.forEach((message, index) => {
    lines.push(formatMessage(message, index, options));
    lines.push('', '---', '');
  });

  return lines.join('\n');
}
