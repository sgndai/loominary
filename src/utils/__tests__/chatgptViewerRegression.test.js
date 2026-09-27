import { extractChatGPTData, detectChatGPTBranches } from '../fileParser/chatgptParser';
import { analyzeBranches, filterDisplayMessages, ROOT_UUID } from '../branchAnalysis';

function msg(id, role, text, parent, children = []) {
  return {
    id,
    parent,
    children,
    message: {
      id,
      author: { role },
      create_time: 1776160800,
      content: { content_type: 'text', parts: [text] },
      metadata: {}
    }
  };
}

function buildEditedConversationFixture() {
  return {
    title: 'Edited prompt branch fixture',
    conversation_id: 'fixture-conversation',
    create_time: 1776160800,
    update_time: 1776160900,
    current_node: 'assistant-current',
    mapping: {
      root: { id: 'root', parent: null, children: ['user-old', 'user-current'] },
      'user-old': msg('user-old', 'user', 'two sentences', 'root', ['assistant-old-1', 'assistant-old-2']),
      'assistant-old-1': msg('assistant-old-1', 'assistant', 'first old answer', 'user-old'),
      'assistant-old-2': msg('assistant-old-2', 'assistant', 'regenerated old answer', 'user-old'),
      'user-current': msg('user-current', 'user', 'three sentences', 'root', ['assistant-current']),
      'assistant-current': msg('assistant-current', 'assistant', 'current answer', 'user-current')
    }
  };
}

function buildRetryFixture() {
  return {
    title: 'Retry fixture',
    conversation_id: 'retry-conversation',
    current_node: 'assistant-2',
    mapping: {
      root: { id: 'root', parent: null, children: ['user-1'] },
      'user-1': msg('user-1', 'user', 'question', 'root', ['assistant-1', 'assistant-2']),
      'assistant-1': msg('assistant-1', 'assistant', 'first answer', 'user-1'),
      'assistant-2': msg('assistant-2', 'assistant', 'second answer', 'user-1')
    }
  };
}

function process(raw) {
  return detectChatGPTBranches(extractChatGPTData(raw, 'fixture.json'));
}

describe('ChatGPT viewer branch defaults', () => {
  test('uses current_node for edited user-message branches', () => {
    const processed = process(buildEditedConversationFixture());
    const byNode = new Map(processed.chat_history.map(message => [message._node_id, message]));

    expect(byNode.get('user-current')._is_current_path).toBe(true);
    expect(byNode.get('assistant-current')._is_current_path).toBe(true);
    expect(byNode.get('user-old')._is_current_path).toBe(false);

    const analysis = analyzeBranches(processed.chat_history);
    const rootBranch = analysis.branchPoints.get(ROOT_UUID);

    expect(rootBranch).toBeDefined();
    expect(rootBranch.branches[rootBranch.currentBranchIndex].startMessage._node_id).toBe('user-current');

    const visible = filterDisplayMessages(processed.chat_history, new Map(), analysis, false);
    expect(visible.map(message => message._node_id)).toEqual(['user-current', 'assistant-current']);
  });

  test('uses current_node for regenerated assistant replies', () => {
    const processed = process(buildRetryFixture());
    const analysis = analyzeBranches(processed.chat_history);
    const user = processed.chat_history.find(message => message._node_id === 'user-1');
    const branch = analysis.branchPoints.get(user.uuid);

    expect(branch).toBeDefined();
    expect(branch.branches[branch.currentBranchIndex].startMessage._node_id).toBe('assistant-2');

    const visible = filterDisplayMessages(processed.chat_history, new Map(), analysis, false);
    expect(visible.map(message => message._node_id)).toEqual(['user-1', 'assistant-2']);
  });

  test('manual branch selection overrides the current_node default', () => {
    const processed = process(buildEditedConversationFixture());
    const analysis = analyzeBranches(processed.chat_history);
    const rootBranch = analysis.branchPoints.get(ROOT_UUID);
    const oldIndex = rootBranch.branches.findIndex(branch => branch.startMessage._node_id === 'user-old');
    const filters = new Map([[ROOT_UUID, oldIndex]]);

    const visible = filterDisplayMessages(processed.chat_history, filters, analysis, false);
    expect(visible.map(message => message._node_id)).toEqual(['user-old', 'assistant-old-1']);
  });
});


describe('modern ChatGPT reader projection', () => {
  test('keeps assistant scratch state isolated between sibling retry branches', () => {
    const raw = {
      title: 'Branch-local scratch state',
      conversation_id: 'branch-local-state',
      current_node: 'final-b',
      mapping: {
        root: { id: 'root', parent: null, children: ['user'] },
        user: msg('user', 'user', 'question', 'root', ['thought-a', 'thought-b']),
        'thought-a': {
          id: 'thought-a',
          parent: 'user',
          children: ['tool-call-a'],
          message: {
            id: 'thought-a',
            author: { role: 'assistant' },
            create_time: 1776160801,
            content: { content_type: 'thoughts', thoughts: [{ summary: 'thinking A', content: 'detail A' }] },
            metadata: {}
          }
        },
        'tool-call-a': {
          id: 'tool-call-a',
          parent: 'thought-a',
          children: ['tool-result-a'],
          message: {
            id: 'tool-call-a',
            author: { role: 'assistant' },
            create_time: 1776160802,
            content: { content_type: 'code', parts: ['{"query":"A"}'] },
            metadata: {}
          }
        },
        'tool-result-a': {
          id: 'tool-result-a',
          parent: 'tool-call-a',
          children: ['final-a'],
          message: {
            id: 'tool-result-a',
            author: { role: 'tool', name: 'web.run' },
            create_time: 1776160803,
            content: { content_type: 'text', parts: [''] },
            metadata: {
              search_result_groups: [
                { domain: 'example.com', entries: [{ url: 'https://example.com/a', title: 'A' }] }
              ]
            }
          }
        },
        'final-a': {
          ...msg('final-a', 'assistant', 'answer A', 'tool-result-a'),
          message: {
            ...msg('final-a', 'assistant', 'answer A', 'tool-result-a').message,
            end_turn: true,
            recipient: 'all',
            channel: 'final'
          }
        },
        'thought-b': {
          id: 'thought-b',
          parent: 'user',
          children: ['final-b'],
          message: {
            id: 'thought-b',
            author: { role: 'assistant' },
            create_time: 1776160804,
            content: { content_type: 'thoughts', thoughts: [{ summary: 'thinking B', content: 'detail B' }] },
            metadata: {}
          }
        },
        'final-b': {
          ...msg('final-b', 'assistant', 'answer B', 'thought-b'),
          message: {
            ...msg('final-b', 'assistant', 'answer B', 'thought-b').message,
            end_turn: true,
            recipient: 'all',
            channel: 'final'
          }
        }
      }
    };

    const processed = process(raw);
    const byNode = new Map(processed.chat_history.map(message => [message._node_id, message]));

    expect(byNode.get('final-a').thinking).toContain('thinking A');
    expect(byNode.get('final-a').tools).toHaveLength(1);
    expect(byNode.get('final-b').thinking).toContain('thinking B');
    expect(byNode.get('final-b').thinking).not.toContain('thinking A');
    expect(byNode.get('final-b').tools).toHaveLength(0);
  });

  test('hides preambles, tool-recipient placeholders, and redacted placeholder messages', () => {
    const raw = {
      title: 'Modern technical nodes',
      conversation_id: 'modern-technical-nodes',
      current_node: 'final',
      mapping: {
        root: { id: 'root', parent: null, children: ['user'] },
        user: msg('user', 'user', 'question', 'root', ['preamble']),
        preamble: {
          id: 'preamble',
          parent: 'user',
          children: ['tool-recipient'],
          message: {
            id: 'preamble',
            author: { role: 'assistant' },
            create_time: 1776160801,
            content: { content_type: 'text', parts: ['I will search first.'] },
            end_turn: false,
            recipient: 'all',
            channel: 'commentary',
            metadata: { is_thinking_preamble_message: true }
          }
        },
        'tool-recipient': {
          id: 'tool-recipient',
          parent: 'preamble',
          children: ['tool-result'],
          message: {
            id: 'tool-recipient',
            author: { role: 'assistant' },
            create_time: 1776160802,
            content: { content_type: 'text', parts: [''] },
            end_turn: false,
            recipient: 'web.run',
            channel: null,
            metadata: {}
          }
        },
        'tool-result': {
          id: 'tool-result',
          parent: 'tool-recipient',
          children: ['redacted'],
          message: {
            id: 'tool-result',
            author: { role: 'tool', name: 'web.run' },
            create_time: 1776160803,
            content: { content_type: 'text', parts: [''] },
            metadata: {}
          }
        },
        redacted: {
          id: 'redacted',
          parent: 'tool-result',
          children: ['final'],
          message: {
            id: 'redacted',
            author: { role: 'assistant' },
            create_time: 1776160804,
            content: { content_type: 'text', parts: ['The output of this plugin was redacted.'] },
            end_turn: false,
            recipient: 'all',
            channel: null,
            metadata: {}
          }
        },
        final: {
          ...msg('final', 'assistant', 'final answer', 'redacted'),
          message: {
            ...msg('final', 'assistant', 'final answer', 'redacted').message,
            end_turn: true,
            recipient: 'all',
            channel: 'final'
          }
        }
      }
    };

    const processed = process(raw);
    expect(processed.chat_history.map(message => message._node_id)).toEqual(['user', 'final']);
    expect(processed.chat_history[1].parent_uuid).toBe(processed.chat_history[0].uuid);
  });

  test('extracts only textual parts from multimodal user content', () => {
    const raw = {
      title: 'Multimodal user fixture',
      conversation_id: 'multimodal-user',
      current_node: 'final',
      mapping: {
        root: { id: 'root', parent: null, children: ['user'] },
        user: {
          id: 'user',
          parent: 'root',
          children: ['final'],
          message: {
            id: 'user',
            author: { role: 'user' },
            create_time: 1776160800,
            content: {
              content_type: 'multimodal_text',
              parts: [
                {
                  content_type: 'image_asset_pointer',
                  asset_pointer: 'sediment://file_fixture',
                  size_bytes: 123
                },
                'describe this screenshot'
              ]
            },
            metadata: {}
          }
        },
        final: {
          ...msg('final', 'assistant', 'done', 'user'),
          message: {
            ...msg('final', 'assistant', 'done', 'user').message,
            end_turn: true,
            recipient: 'all',
            channel: 'final'
          }
        }
      }
    };

    const processed = process(raw);
    const user = processed.chat_history.find(message => message._node_id === 'user');
    expect(user.display_text).toBe('describe this screenshot');
    expect(user.display_text).not.toContain('[object Object]');
  });

  test('keeps legacy assistant text visible when channel metadata is absent', () => {
    const processed = process({
      title: 'Legacy fixture',
      conversation_id: 'legacy-fixture',
      current_node: 'assistant',
      mapping: {
        root: { id: 'root', parent: null, children: ['user'] },
        user: msg('user', 'user', 'question', 'root', ['assistant']),
        assistant: msg('assistant', 'assistant', 'legacy answer', 'user')
      }
    });

    expect(processed.chat_history.map(message => message.display_text)).toEqual(['question', 'legacy answer']);
  });
});
