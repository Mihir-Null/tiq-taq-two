/**
 * The game controller with the local driver: undo must never leave a game
 * stuck with the bot to move and nobody thinking.
 */
import { describe, expect, it, vi } from 'vitest';
import { X, O, type GameState, type Move } from '../src/engine/index.ts';

// A stand-in bot: instantly plays the first square that is certainly empty.
vi.mock('../src/ai/client.ts', () => ({
  ai: {
    move: async (s: GameState): Promise<Move> => {
      for (let i = 0; i < 9; i++) if (s.q.certainlyEmpty(i)) return { kind: 'place', cell: i };
      throw new Error('board full');
    },
    hints: async () => [],
  },
}));
const { GameController, LocalDriver } = await import('../src/ui/game/controller.ts');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function botPlaysX() {
  const ctrl = new GameController({
    rules: { level: 1, quanta: 0 },
    seats: {
      [X]: { kind: 'bot', name: 'Kitten', difficulty: 'easy', local: false },
      [O]: { kind: 'human', name: 'You', local: true },
    },
    driver: new LocalDriver('test-seed'),
    undoAllowed: true,
    muted: true,
  });
  ctrl.start();
  return ctrl;
}

describe('undo against the bot', () => {
  it("can't undo the bot's opening move — and the game doesn't freeze trying", async () => {
    const ctrl = botPlaysX();
    await sleep(900); // the bot always takes at least 0.7 s
    expect(ctrl.snapshots.value).toHaveLength(2);
    expect(ctrl.canUndo.value).toBe(false);
    ctrl.driver.undo!(ctrl);
    expect(ctrl.snapshots.value).toHaveLength(2);
    expect(ctrl.canAct.value).toBe(true);
    ctrl.dispose();
  });

  it('undoing while the bot thinks returns to your move and cancels its reply', async () => {
    const ctrl = botPlaysX();
    await sleep(900);
    ctrl.commit({ kind: 'place', cell: 8 });
    expect(ctrl.thinking.value).toBe(true);
    expect(ctrl.canUndo.value).toBe(true);
    ctrl.driver.undo!(ctrl);
    expect(ctrl.snapshots.value).toHaveLength(2);
    await sleep(900);
    expect(ctrl.snapshots.value).toHaveLength(2); // the cancelled reply never lands
    expect(ctrl.canAct.value).toBe(true);
    ctrl.dispose();
  });

  it('releases whoever waits for animations when the game is closed', async () => {
    const ctrl = botPlaysX();
    ctrl.anim.value = { kind: 'collapse', id: -1, event: null as never };
    const waiting = ctrl.whenIdle();
    ctrl.dispose();
    await expect(Promise.race([waiting.then(() => 'released'), sleep(100).then(() => 'stuck')])).resolves.toBe('released');
  });
});
