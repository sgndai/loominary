import { createConversationRecord } from './normalizedAdapter.mjs';

const ROOT_UUID = '00000000-0000-4000-8000-000000000000';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function firstString(...values) {
  return values.find(value => typeof value === 'string' && value.length > 0) || null;
}
