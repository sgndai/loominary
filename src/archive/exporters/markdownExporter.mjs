function formatCitation(citation) {
  if (!citation) return '';
  const title = citation.title || citation.url || 'Source';
  return citation.url ? `- [${title}](${citation.url})` : `- ${title}`;
}

function formatMessage(message, index) {
  const role = message.role || 'unknown';
  const lines = [`## ${index + 1}. ${role}`];

  if (message.createdAt) {
    lines.push(`_${message.createdAt}_`);
  }

  lines.push('');
  lines.push(message.text || '');

  if (message.thinking) {
    lines.push('', '<details>', '<summary>Thinking</summary>', '', message.thinking, '', '</details>');
  }

  if (message.citations?.length) {
    lines.push('', '### Citations');
    lines.push(...message.citations.map(formatCitation));
  }

  if (message.attachments?.length) {
    lines.push('', '### Attachments');
    for (const attachment of message.attachments) {
      lines.push(`- ${attachment.name || attachment.id}`);
    }
  }

  if (message.toolCalls?.length) {
    lines.push('', '### Tool Calls');
    for (const tool of message.toolCalls) {
      lines.push(`- ${tool.name}`);
    }
  }

  return lines.join('\n');
}

export function exportConversationMarkdown(record) {
  const lines = [
    `# ${record.conversation.title}`,
    '',
    `Platform: ${record.conversation.platform}`,
    '',
    '---',
    ''
  ];

  record.messages.forEach((message, index) => {
    lines.push(formatMessage(message, index));
    lines.push('', '---', '');
  });

  return lines.join('\n');
}
