import test from 'node:test';
import assert from 'node:assert/strict';

import { collectChatgptAttachmentReferences } from '../src/archive/chatgptBrowserCollector.mjs';
import { normalizeChatgptRawConversation } from '../src/archive/chatgptRawNormalizer.mjs';

const baseMessage = {
  id: 'message-1',
  author: { role: 'user' },
  create_time: 1,
  content: {
    parts: [
      'Please inspect these files.',
      {
        content_type: 'image_asset_pointer',
        asset_pointer: 'sediment