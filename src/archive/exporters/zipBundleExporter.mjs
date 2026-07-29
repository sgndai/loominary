import { zipSync, strToU8 } from 'fflate';

import { exportConversationBundle } from './bundleExporter.mjs';

function normalizeEntry(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return strToU8(String(value));
}

function normalizeEntries(entries) {
  return Object.fromEntries(
    Object.entries(entries).map(([name, value]) => [name, normalizeEntry(value)])
  );
}

export function exportConversationZipBundle(record, options = {}) {
  const bundle = exportConversationBundle(record, options);
  const files = normalizeEntries(bundle.entries);

  const zipped = zipSync(files, {
    level: options.level ?? 6
  });

  return {
    filename: bundle.filename,
    mimeType: 'application/zip',
    bytes: zipped,
    manifest: bundle.manifest
  };
}
