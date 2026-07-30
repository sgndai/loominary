import { validateConversationRecord } from '../../../server/archive/contract.mjs';
import { exportConversationJson } from './jsonExporter.mjs';
import { exportConversationMarkdown } from './markdownExporter.mjs';

const MIME_EXTENSIONS = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/svg+xml', 'svg'],
  ['application/pdf', 'pdf'],
  ['application/zip', 'zip'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
  ['text/plain', 'txt'],
  ['text/markdown', 'md'],
  ['text/html', 'html'],
  ['application/json', 'json'],
  ['text/csv', 'csv']
]);

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function rotateRight(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Hex(bytes) {
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[bytes.length] = 0x80;

  const view = new DataView(data.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15];
      const right = words[index - 2];
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 = (h + sigma1 + choose + SHA256_K[index] + words[index]) >>> 0;
      const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sigma0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return [...hash].map(value => value.toString(16).padStart(8, '0')).join('');
}

function safeFileName(value, fallback = 'conversation') {
  const normalized = String(value || fallback)
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  return (normalized || fallback).slice(0, 120);
}

function safeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function decodeBase64(value) {
  const binary = globalThis.atob(value.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function parseDataUri(location, fallbackMimeType) {
  if (typeof location !== 'string' || !location.startsWith('data:')) return null;
  const match = /^data:([^,]*),(.*)$/s.exec(location);
  if (!match) return null;

  const parts = match[1].split(';').filter(Boolean);
  const mimeType = parts[0] && !parts[0].includes('=')
    ? parts[0]
    : fallbackMimeType || 'application/octet-stream';
  const isBase64 = parts.includes('base64');

  try {
    const bytes = isBase64
      ? decodeBase64(match[2])
      : new TextEncoder().encode(decodeURIComponent(match[2]));
    return { bytes, mimeType };
  } catch {
    return null;
  }
}

function addExtension(name, mimeType) {
  if (/\.[a-zA-Z0-9]{1,12}$/.test(name)) return name;
  const extension = MIME_EXTENSIONS.get(mimeType);
  return extension ? `${name}.${extension}` : name;
}

function appendDigest(name, digest) {
  const dot = name.lastIndexOf('.');
  return dot > 0
    ? `${name.slice(0, dot)}-${digest.slice(0, 8)}${name.slice(dot)}`
    : `${name}-${digest.slice(0, 8)}`;
}

function externalizeAttachments(record) {
  const binaryEntries = {};
  const manifestFiles = [];
  const safeUrls = new Set();
  const digestOwners = new Map();
  const usedPaths = new Map();

  for (const message of record.messages || []) {
    for (const citation of message.citations || []) {
      const url = safeUrl(citation.url);
      if (url) safeUrls.add(url);
    }
  }

  const messages = (record.messages || []).map(message => ({
    ...message,
    attachments: (message.attachments || []).map((attachment, index) => {
      const remoteUrl = safeUrl(attachment.location);
      if (remoteUrl) safeUrls.add(remoteUrl);

      const parsed = parseDataUri(attachment.location, attachment.mimeType);
      const manifestFile = {
        id: attachment.id,
        messageId: message.id,
        name: attachment.name,
        mimeType: attachment.mimeType || parsed?.mimeType || 'application/octet-stream',
        source: attachment.source || null,
        size: attachment.size ?? parsed?.bytes.length ?? 0,
        url: remoteUrl,
        path: null,
        sha256: null,
        embedded: false
      };

      if (!parsed) {
        manifestFiles.push(manifestFile);
        return attachment;
      }

      const digest = sha256Hex(parsed.bytes);
      const owner = digestOwners.get(digest);
      let path;

      if (owner) {
        path = owner.path;
        manifestFile.duplicateOf = owner.id;
      } else {
        const directory = manifestFile.mimeType.startsWith('image/') ? 'images' : 'files';
        const fallback = `${message.id}-${index + 1}`;
        let name = addExtension(safeFileName(attachment.name, fallback), manifestFile.mimeType);
        path = `attachments/${directory}/${name}`;

        if (usedPaths.has(path) && usedPaths.get(path) !== digest) {
          name = appendDigest(name, digest);
          path = `attachments/${directory}/${name}`;
        }

        usedPaths.set(path, digest);
        digestOwners.set(digest, { path, id: attachment.id });
        binaryEntries[path] = parsed.bytes;
      }

      manifestFile.path = path;
      manifestFile.sha256 = digest;
      manifestFile.size = parsed.bytes.length;
      manifestFile.embedded = true;
      manifestFiles.push(manifestFile);

      return {
        ...attachment,
        mimeType: manifestFile.mimeType,
        size: manifestFile.size,
        location: path,
        metadata: {
          ...(attachment.metadata || {}),
          bundlePath: path,
          sha256: digest,
          originalLocationType: 'data-uri'
        }
      };
    })
  }));

  return {
    record: { ...record, messages },
    binaryEntries,
    manifestFiles,
    safeUrls: [...safeUrls].sort()
  };
}

function finiteCount(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function buildIntegrity(assetReport, manifestFiles) {
  const embeddedAttachments = manifestFiles.filter(file => file.embedded).length;
  const externalAttachments = manifestFiles.length - embeddedAttachments;

  if (!assetReport || typeof assetReport !== 'object') {
    return {
      status: 'not-checked',
      expected: null,
      downloaded: null,
      failed: null,
      archivedAttachments: manifestFiles.length,
      embeddedAttachments,
      externalAttachments,
      failures: []
    };
  }

  const expected = finiteCount(assetReport.expected);
  const downloaded = finiteCount(assetReport.downloaded);
  const failed = finiteCount(assetReport.failed, Math.max(0, expected - downloaded));
  const complete = failed === 0 && downloaded === expected;

  return {
    status: complete ? 'complete' : 'partial',
    expected,
    downloaded,
    failed,
    archivedAttachments: manifestFiles.length,
    embeddedAttachments,
    externalAttachments,
    failures: Array.isArray(assetReport.failures) ? assetReport.failures : []
  };
}

function buildReadme(record, integrity) {
  const title = record.conversation?.title || 'Untitled conversation';
  const statusLabels = {
    complete: '完整',
    partial: '不完整',
    'not-checked': '未检查'
  };

  const lines = [
    '# Loominary 对话归档',
    '',
    `对话：${title}`,
    '',
    '## 文件说明',
    '',
    '- `conversation.md`：适合直接阅读的完整对话。',
    '- `conversation.json`：结构化 Archive Model，供程序处理；附件二进制已移出 JSON。',
    '- `manifest.json`：附件路径、哈希、来源链接和完整性报告。',
    '- `attachments/images/`：归档图片。',
    '- `attachments/files/`：归档文档及其他文件。',
    '',
    '## 附件完整性',
    '',
    `- 状态：${statusLabels[integrity.status] || integrity.status}`,
    `- 发现附件：${integrity.expected ?? '未检查'}`,
    `- 下载成功：${integrity.downloaded ?? '未检查'}`,
    `- 下载失败：${integrity.failed ?? '未检查'}`,
    `- 归档附件记录：${integrity.archivedAttachments}`,
    `- 已写入 ZIP：${integrity.embeddedAttachments}`,
    `- 仅保留外部引用：${integrity.externalAttachments}`
  ];

  if (integrity.failures.length) {
    lines.push('', '## 下载失败', '');
    for (const failure of integrity.failures) {
      lines.push(`- ${failure.name || failure.fileId || '未知附件'}：${failure.reason || '未知错误'}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

export function exportConversationBundle(record, options = {}) {
  validateConversationRecord(record);

  const title = safeFileName(record.conversation?.title);
  const externalized = externalizeAttachments(record);
  const integrity = buildIntegrity(options.assetReport, externalized.manifestFiles);
  const entries = {
    'README.md': buildReadme(externalized.record, integrity),
    'conversation.md': exportConversationMarkdown(externalized.record),
    'conversation.json': exportConversationJson(externalized.record)
  };

  Object.assign(entries, externalized.binaryEntries);

  const manifest = {
    schemaVersion: 'loominary.bundle/v2',
    conversationId: record.conversation.id,
    createdAt: options.createdAt || null,
    integrity,
    files: externalized.manifestFiles,
    safeUrls: externalized.safeUrls,
    exports: [...Object.keys(entries), 'manifest.json'].sort()
  };

  entries['manifest.json'] = JSON.stringify(manifest, null, 2);

  return {
    filename: `${title}.zip`,
    entries,
    manifest,
    record: externalized.record
  };
}
