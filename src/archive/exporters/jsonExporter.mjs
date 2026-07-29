import { validateConversationRecord } from '../../../server/archive/contract.mjs';

export function exportConversationJson(record, options = {}) {
  validateConversationRecord(record);

  const payload = {
    schemaVersion: 'loominary.export/v1',
    exportedAt: options.exportedAt || null,
    conversation: record
  };

  return JSON.stringify(payload, null, options.pretty === false ? 0 : 2);
}
