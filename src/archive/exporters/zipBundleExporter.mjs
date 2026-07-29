import { zipSync, strToU8 } from 'fflate';

import { exportConversationBundle } from './bundleExporter.mjs';

function normalizeEntries(entries) {
  return Object.fromEntries(
    Object.entries(entries).map(([name, value]) => [name, strToU8(String(value))])
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
    bytes: zipped
  };
}
