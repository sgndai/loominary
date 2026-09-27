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
