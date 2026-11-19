import { describe, expect, it } from 'vitest';
import { createGuide } from '../src/guide.js';

const hand = (pinched) => ({ id: 'Left', pinched });

function setup() {
  const shown = [];
  const reports = [];
  const guide = createGuide({ show: (text) => shown.push(text), report: (m) => reports.push(m) });
  return { guide, shown, reports };
}

describe('gesture guide', () => {
  it('goes from showing a hand to turning, to zooming, then finishes', () => {
    const { guide, shown, reports } = setup();
    guide.setState('on');
    expect(shown.at(-1)).toContain('手を映して');
    guide.update([]);
    expect(shown).toHaveLength(1);
    guide.update([hand(false)]);
    expect(shown.at(-1)).toContain('回ります');
    for (let i = 0; i < 30; i++) guide.update([hand(true)]);
    expect(shown.at(-1)).toContain('両手');
    for (let i = 0; i < 30; i++) guide.update([hand(true), hand(true)]);
    expect(shown.at(-1)).toBe('');
    expect(reports).toEqual([{ hands: 'on' }, { guide: 'done' }]);
  });

  it('clears the line when the camera is turned off', () => {
    const { guide, shown, reports } = setup();
    guide.setState('on');
    guide.setState('off');
    guide.update([hand(true)]);
    expect(shown.at(-1)).toBe('');
    expect(reports.at(-1)).toEqual({ hands: 'off' });
  });
});
