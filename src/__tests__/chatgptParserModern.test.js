import { extractChatGPTData, detectChatGPTBranches } from '../utils/fileParser/chatgptParser';
import { analyzeBranches, filterDisplayMessages } from '../utils/branchAnalysis';

const ROOT = 'client-created-root';

function userMessage(id, parent, children, text, content = null) {
  return {
    id,
    parent,
    children,
    message: {
      id,
      author: { role: 'user' },
      create_time: 1780000000,
      content: content || { content_type: 'text', parts: [text] },
      metadata: {}
    }
  };
}

function assistantMessage(id, parent, children, {
  text = '',
  contentType = 'text',
  parts = null,
  recipient = 'all',
  channel = null,
  endTurn = true,
  metadata = {}
} = {}) {
  const content = contentType === 'thoughts'
    ? { content_type: 'thoughts', thoughts: [{ summary: text, content: '' }] }
    : contentType === 'code'
      ? { content_type: 'code', text }
      : { content_type: contentType, parts: parts || [text] };

  return {
    id,
    parent,
    children,
    message: {
      id,
      author: { role: 'assistant' },
      create_time: 1780000001,
      content,
      status: endTurn ? 'finished_successfully' : 'in_progress',
      end_turn: endTurn,
      metadata,
      recipient,
      channel
    }
  };
}

function toolMessage(id, parent, children, toolName, resultText) {
  return {
    id,
    parent,
    children,
    message: {
      id,
      author: { role: 'tool', name: toolName },
      create_time: 1780000002,
      content: { content_type: 'text', parts: [resultText] },
      metadata: {
        search_result_groups: [{
          domain: 'example.com',
          entries: [{ url: 'https://example.com', title: resultText, snippet: resultText }]
        }]
      }
    }
  };
}

describe('modern ChatGPT reader projection', () => {
  test('keeps assistant branch-local thinking and tools isolated', () => {
    const data = {
      title: 'branch-local-state',
      conversation_id: 'conv-branch-local',
      current_node: 'final-b',
      mapping: {
        [ROOT]: { id: ROOT, parent: null, children: ['user'] },
        user: userMessage('user', ROOT, ['think-a', 'think-b'], 'question'),
        'think-a': assistantMessage('think-a', 'user', ['call-a'], {
          text: 'thinking A',
          contentType: 'thoughts',
          endTurn: false
        }),
        'call-a': assistantMessage('call-a', 'think-a', ['tool-a'], {
          text: JSON.stringify({ search_query: [{ q: 'alpha' }] }),
          contentType: 'code',
          recipient: 'web.run',
          endTurn: false
        }),
        'tool-a': toolMessage('tool-a', 'call-a', ['final-a'], 'web.run', 'result A'),
        'final-a': assistantMessage('final-a', 'tool-a', [], { text: 'answer A' }),
        'think-b': assistantMessage('think-b', 'user', ['call-b'], {
          text: 'thinking B',
          contentType: 'thoughts',
          endTurn: false
        }),
        'call-b': assistantMessage('call-b', 'think-b', ['tool-b'], {
          text: JSON.stringify({ search_query: [{ q: 'beta' }] }),
          contentType: 'code',
          recipient: 'web.run',
          endTurn: false
        }),
        'tool-b': toolMessage('tool-b', 'call-b', ['final-b'], 'web.run', 'result B'),
        'final-b': assistantMessage('final-b', 'tool-b', [], { text: 'answer B' })
      }
    };

    const parsed = detectChatGPTBranches(extractChatGPTData(data, 'branch.json'));
    const finals = parsed.chat_history.filter(message => message.sender === 'assistant');

    expect(finals.map(message => message.display_text)).toEqual(['answer A', 'answer B']);
    expect(finals[0].thinking).toContain('thinking A');
    expect(finals[0].thinking).not.toContain('thinking B');
    expect(finals[1].thinking).toContain('thinking B');
    expect(finals[1].thinking).not.toContain('thinking A');

    expect(JSON.stringify(finals[0].tools)).toContain('alpha');
    expect(JSON.stringify(finals[0].tools)).toContain('result A');
    expect(JSON.stringify(finals[0].tools)).not.toContain('beta');
    expect(JSON.stringify(finals[1].tools)).toContain('beta');
    expect(JSON.stringify(finals[1].tools)).toContain('result B');
    expect(JSON.stringify(finals[1].tools)).not.toContain('alpha');

    const analysis = analyzeBranches(parsed.chat_history);
    const visible = filterDisplayMessages(parsed.chat_history, new Map(), analysis, false);
    expect(visible.map(message => message.display_text)).toEqual(['question', 'answer B']);
  });

  test('does not create visible cards for technical, preamble, empty, or redacted assistant nodes', () => {
    const data = {
      title: 'technical-nodes',
      conversation_id: 'conv-technical',
      current_node: 'final',
      mapping: {
        [ROOT]: { id: ROOT, parent: null, children: ['user'] },
        user: userMessage('user', ROOT, ['preamble'], 'question'),
        preamble: assistantMessage('preamble', 'user', ['tool-call'], {
          text: 'I will search first',
          endTurn: false,
          channel: 'commentary',
          metadata: { is_thinking_preamble_message: true }
        }),
        'tool-call': assistantMessage('tool-call', 'preamble', ['empty'], {
          text: '{"search_query":[{"q":"topic"}]}',
          recipient: 'web.run',
          endTurn: false
        }),
        empty: assistantMessage('empty', 'tool-call', ['redacted'], {
          text: '',
          endTurn: false
        }),
        redacted: assistantMessage('redacted', 'empty', ['final'], {
          text: 'The output of this plugin was redacted.',
          endTurn: false
        }),
        final: assistantMessage('final', 'redacted', [], { text: 'real answer' })
      }
    };

    const parsed = extractChatGPTData(data, 'technical.json');
    expect(parsed.chat_history.map(message => message.display_text)).toEqual(['question', 'real answer']);
    expect(parsed.raw_data.mapping['tool-call']).toBeTruthy();
    expect(parsed.raw_data.mapping.preamble).toBeTruthy();
  });

  test('multimodal user parts contribute text without object stringification and preserve pointer attachments', () => {
    const multimodal = {
      content_type: 'multimodal_text',
      parts: [
        {
          content_type: 'image_asset_pointer',
          asset_pointer: 'file-service://image-1',
          width: 1024,
          height: 768
        },
        'caption text'
      ]
    };
    const data = {
      title: 'multimodal',
      conversation_id: 'conv-multimodal',
      current_node: 'final',
      mapping: {
        [ROOT]: { id: ROOT, parent: null, children: ['user'] },
        user: userMessage('user', ROOT, ['final'], '', multimodal),
        final: assistantMessage('final', 'user', [], { text: 'answer' })
      }
    };

    const parsed = extractChatGPTData(data, 'multimodal.json');
    const user = parsed.chat_history[0];

    expect(user.display_text).toBe('caption text');
    expect(user.display_text).not.toContain('[object Object]');
    expect(user.attachments.some(item => item.id === 'file-service://image-1')).toBe(true);
  });

  test('older assistant text with null recipient and null end_turn remains visible', () => {
    const data = {
      title: 'legacy',
      conversation_id: 'conv-legacy',
      current_node: 'assistant',
      mapping: {
        [ROOT]: { id: ROOT, parent: null, children: ['user'] },
        user: userMessage('user', ROOT, ['assistant'], 'question'),
        assistant: {
          id: 'assistant',
          parent: 'user',
          children: [],
          message: {
            id: 'assistant',
            author: { role: 'assistant' },
            create_time: 1780000001,
            content: { content_type: 'text', parts: ['legacy answer'] },
            status: 'finished_successfully',
            end_turn: null,
            metadata: {},
            recipient: null,
            channel: null
          }
        }
      }
    };

    const parsed = extractChatGPTData(data, 'legacy.json');
    expect(parsed.chat_history.map(message => message.display_text)).toEqual(['question', 'legacy answer']);
  });
});
