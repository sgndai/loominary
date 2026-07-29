import { adaptProviderConversation } from './adapterRegistry.mjs';
import { normalizeChatgptRawConversation } from './chatgptRawNormalizer.mjs';
import { exportConversationZipBundle } from './exporters/zipBundleExporter.mjs';

function normalizeBrowserInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Conversation export input must be an object');
  }

  if (input.mapping && typeof input.mapping === 'object') {
    return normalizeChatgptRawConversation(input);
  }

  if (Array.isArray(input.chat_history) && input.format) {
    return input;
  }

  if (typeof _parseRaw === 'function') {
    const parsed = _parseRaw(input);
    if (parsed) return parsed;
  }

  return input;
}

export function createBrowserArchiveRecord(input) {
  return adaptProviderConversation(normalizeBrowserInput(input));
}

export function exportBrowserArchiveBundle(input, options = {}) {
  const record = createBrowserArchiveRecord(input);
  return exportConversationZipBundle(record, options);
}

const browserGlobal = typeof unsafeWindow !== 'undefined'
  ? unsafeWindow
  : typeof window !== 'undefined'
    ? window
    : globalThis;

browserGlobal.LoominaryArchiveCreateRecord = createBrowserArchiveRecord;
browserGlobal.LoominaryArchiveBundle = exportBrowserArchiveBundle;
