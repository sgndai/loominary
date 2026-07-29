import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';

import { exportConversationZipBundle } from '../src/archive/exporters/index.mjs';
import { adaptProviderConversation } from '../src/archive/adapterRegistry.mjs';

const imageBytes = Buffer.from('hello-image');
const image = imageBytes.toString('base64');

const fixture = {
  meta_info: {
    uuid: 'attachment-test',
    title: 'Attachment test',
    platform: 'chatgpt'
  },
  chat_history: [
    {
      uuid: 'm1',
      sender: 'assistant',
      display_text: 'image',
      attachments: [
        {
          id: 'image-1',
          name: 'test.png',
          mimeType: 'image/png',
          location: `data:image/png;base64,${image}`
        },
        {
          id: 'image-2',
          name: 'copy.png',
          mimeType: 'image/png',
          location: `data:image/png;base64,${image}`
        }
      ],
      citations: [
        {
          url: 'https://example.com/source',
          title: 'Example'
        }
      ]
    }
  ]
};

test('bundle externalizes embedded attachments and keeps safe URLs', () => {
  const record = adaptProviderConversation(fixture);
  const zip = exportConversationZipBundle(record);
  const files = unzipSync(zip.bytes);

  assert.ok(files['manifest.json']);
  assert.ok(files['conversation.json']);
  assert.ok(files['attachments/sources/remote-urls.json']);

  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  assert.equal(manifest.safeUrls[0], 'https://example.com/source');
  assert.equal(manifest.files.length, 2);
  assert.equal(manifest.files[1].duplicateOf, 'image-1');
  assert.equal(manifest.files[0].path, manifest.files[1].path);

  const imagePaths = Object.keys(files).filter(path => path.startsWith('attachments/images/'));
  assert.deepEqual(imagePaths, ['attachments/images/test.png']);
  assert.deepEqual(files[imagePaths[0]], new Uint8Array(imageBytes));

  const json = strFromU8(files['conversation.json']);
  assert.doesNotMatch(json, /data:image\/png;base64/);
  assert.match(json, /attachments\/images\/test\.png/);

  const safeUrls = JSON.parse(strFromU8(files['attachments/sources/remote-urls.json']));
  assert.deepEqual(safeUrls.urls, ['https://example.com/source']);
});
