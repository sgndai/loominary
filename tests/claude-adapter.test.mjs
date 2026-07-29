import test from 'node:test';
import assert from 'node:assert/strict';

import { claudeToArchiveBundle, claudeToArchiveRecord } from '../src/archive/claudeAdapter.mjs';

test('Claude adapter preserves branches, rich content, artifacts, attachments, and context', () => {
  const processedData = {
    format: 'claude',
    meta_info: {
      uuid: 'claude-conv-1',
      title: 'Claude adapter test',
      project_uuid: 'project-1',
      organization_id: 'org-1',
      project: {
        uuid: 'project-1',
        name: 'Adapter project',
        knowledge_files: [{ uuid: 'file-1', file_name: 'guide.md', summary: 'Guide' }],
        memories: { project: [{ id: 'memory-1', content: 'Keep branches.' }] }
      }
    },
    chat_history: [
      {
        index: 0,
        uuid: 'msg-1',
        parent_uuid: null,
        sender: 'human',
        display_text: 'Question',
        branch_id: 'main',
        attachments: [{ file_name: 'brief.pdf', file_type: 'application/pdf' }],
        images: []
      },
      {
        index: 1,
        uuid: 'msg-2',
        parent_uuid: 'msg-1',
        sender: 'assistant',
        display_text: 'Answer',
        branch_id: 'main',
        thinking: 'Reason',
        tools: [{ name: 'search', input: {}, result: {} }],
        artifacts: [{ id: 'artifact-1', title: 'Plan' }],
        citations: [{ type: 'web', url: 'https://example.com' }],
        images: [{ file_name: 'chart.png', file_type: 'image/png', preview_url: 'https://example.com/chart.png' }]
      }
    ]
  };

  const bundle = claudeToArchiveBundle(processedData);
  const record = bundle.conversation;

  assert.equal(record.conversation.platform, 'claude');
  assert.equal(record.messages[1].thinking, 'Reason');
  assert.equal(record.messages[1].toolCalls[0].name, 'search');
  assert.equal(record.messages[1].citations[0].url, 'https://example.com');
  assert.equal(record.messages[1].attachments[0].name, 'chart.png');
  assert.equal(bundle.context.project.name, 'Adapter project');
  assert.equal(bundle.context.project.knowledgeFiles[0].name, 'guide.md');
});

test('Claude adapter derives branch topology without branch markers', () => {
  const record = claudeToArchiveRecord({
    meta_info: { uuid: 'claude-conv-2', title: 'Branches' },
    chat_history: [
      { uuid: 'root', sender: 'human', display_text: 'Q' },
      { uuid: 'a', parent_uuid: 'root', sender: 'assistant', display_text: 'A' },
      { uuid: 'b', parent_uuid: 'root', sender: 'assistant', display_text: 'B' }
    ]
  });

  assert.equal(record.branches.length, 2);
  assert.equal(record.messages.find(message => message.id === 'b').branchId, 'main.1');
});
