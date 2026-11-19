// Walks a first-time visitor through the hand gestures, one line at a time.
const STEPS = {
  show: 'カメラに手を映してください',
  turn: '親指と人差し指をつまんだまま動かすと、回ります',
  zoom: '次は両手でつまんで広げると、大きくなります',
};
// Frames of pinching (about 30 a second) that count as having tried a gesture.
const TRIED = 30;

export function createGuide({ show, report }) {
  let step = null;
  let frames = 0;

  function go(next) {
    step = next;
    frames = 0;
    show(next ? STEPS[next] : '');
    if (!next) report({ guide: 'done' });
  }

  return {
    /** state is the state of hand control: 'off' | 'starting' | 'on'. */
    setState(state) {
      report({ hands: state });
      if (state === 'on') go('show');
      else {
        step = null;
        show('');
      }
    },
    /** hands is the list of detected hands, each with a pinched flag. */
    update(hands) {
      if (!step) return;
      const pinching = hands.filter((hand) => hand.pinched).length;
      if (step === 'show') {
        if (hands.length) go('turn');
      } else if (step === 'turn') {
        if (pinching === 1 && ++frames >= TRIED) go('zoom');
      } else if (pinching === 2 && ++frames >= TRIED) go(null);
    },
  };
}
