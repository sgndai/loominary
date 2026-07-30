import { adaptProviderConversation } from './adapterRegistry.mjs';
import { collectCurrentChatgptArchiveInput } from './chatgptBrowserCollector.mjs';
import { normalizeChatgptRawConversation } from './chatgptRawNormalizer.mjs';
import { exportConversationZipBundle } from './exporters/zipBundleExporter.mjs';

function unwrapBrowserInput(input) {
  if (input?.rawConversation && typeof input.rawConversation === 'object') {
    return input.rawConversation;
  }
  return input;
}

function normalizeBrowserInput(input) {
  const source = unwrapBrowserInput(input);
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new TypeError('Conversation export input must be an object');
  }

  if (Array.isArray(source.chat_history) && source.format) {
    return source;
  }

  if (source.mapping && typeof source.mapping === 'object') {
    return normalizeChatgptRawConversation(source);
  }

  if (typeof _parseRaw === 'function') {
    const parsed = _parseRaw(source);
    if (parsed) return parsed;
  }

  return source;
}

export function createBrowserArchiveRecord(input) {
  return adaptProviderConversation(normalizeBrowserInput(input));
}

export function exportBrowserArchiveBundle(input, options = {}) {
  const source = unwrapBrowserInput(input);
  const record = createBrowserArchiveRecord(source);
  const assetReport = input?.assetReport || source?.loominary_asset_report || options.assetReport || null;
  return exportConversationZipBundle(record, {
    ...options,
    assetReport
  });
}

export async function collectBrowserArchiveInput(platform, options = {}) {
  if (platform === 'chatgpt') {
    return collectCurrentChatgptArchiveInput(options);
  }
  throw new Error(`Browser Archive collection is not implemented for ${platform || 'unknown'}`);
}

const browserGlobal = typeof unsafeWindow !== 'undefined'
  ? unsafeWindow
  : typeof window !== 'undefined'
    ? window
    : globalThis;

browserGlobal.LoominaryArchiveCreateRecord = createBrowserArchiveRecord;
browserGlobal.LoominaryArchiveBundle = exportBrowserArchiveBundle;
browserGlobal.LoominaryArchiveCollectCurrent = collectBrowserArchiveInput;
