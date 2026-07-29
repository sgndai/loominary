import { adaptProviderConversation } from './adapterRegistry.mjs';
import { normalizeChatgptRawConversation } from './chatgptRawNormalizer.mjs';
import { exportConversationZipBundle } from './exporters/zipBundleExporter.mjs';

function normalizeBrowserInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Conversation export input must be an object');
  }

  if (input.mapping && input.current_node) {
    return normalizeChatgptRawConversation(input);
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

const browserGlobal = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
browserGlobal.LoominaryArchiveCreateRecord = createBrowserArchiveRecord;
browserGlobal.LoominaryArchiveBundle = exportBrowserArchiveBundle;
