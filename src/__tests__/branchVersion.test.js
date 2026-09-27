import {
  analyzeBranches,
  getMessageVersionInfo,
  ROOT_UUID
} from '../utils/branchAnalysis';

function message(index, uuid, parentUuid, text, current = false) {
  return {
    index,
    uuid,
    parent_uuid: parentUuid,
    sender: index === 0 ? 'human' : 'assistant',
    sender_label: index === 0 ? 'User' : 'ChatGPT',
    timestamp: index === 1 ? 'not-a-date' : '2026/09/28 05:00:00',
    display_text: text,
    _is_current_path: current
  };
}

describe('inline branch version metadata', () => {
  test('uses message order instead of localized timestamps for version ordering', () => {
    const messages = [
      message(0, 'user', ROOT_UUID, 'question', true),
      message(1, 'a1', 'user', 'answer 1', false),
      message(2, 'a2', 'user', 'answer 2', true)
    ];

    const analysis = analyzeBranches(messages);
    const branch = analysis.branchPoints.get('user');

    expect(branch.branches.map(item => item.startMessage.uuid)).toEqual(['a1', 'a2']);
    expect(branch.currentBranchIndex).toBe(1);

    expect(getMessageVersionInfo(messages[2], analysis)).toEqual({
      branchPointUuid: 'user',
      versionIndex: 1,
      selectedIndex: 1,
      totalVersions: 2,
      canPrevious: true,
      canNext: false
    });
  });

  test('supports root-level user edits as message versions', () => {
    const messages = [
      message(0, 'user-old', ROOT_UUID, 'old question', false),
      message(1, 'assistant-old', 'user-old', 'old answer', false),
      message(2, 'user-current', ROOT_UUID, 'current question', true),
      message(3, 'assistant-current', 'user-current', 'current answer', true)
    ];

    const analysis = analyzeBranches(messages);
    const info = getMessageVersionInfo(messages[2], analysis);

    expect(info.branchPointUuid).toBe(ROOT_UUID);
    expect(info.versionIndex).toBe(1);
    expect(info.totalVersions).toBe(2);
  });
});
