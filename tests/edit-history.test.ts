import { describe, expect, it } from 'vitest';
import { EditHistory } from '../src/ui/edit-history';

describe('Edit history', () => {
  it('undoes and redoes a sequence in order', () => {
    const history = new EditHistory<number>();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undo()).toBeUndefined();
    expect(history.redo()).toBeUndefined();
    history.record(0, 1);
    history.record(1, 2);
    expect(history.undo()).toBe(1);
    expect(history.undo()).toBe(0);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
    expect(history.redo()).toBe(1);
    expect(history.redo()).toBe(2);
    expect(history.canRedo).toBe(false);
    expect(history.canUndo).toBe(true);
  });

  it('ignores unchanged values without discarding redo', () => {
    const history = new EditHistory<{ count: number }>();
    history.record({ count: 0 }, { count: 0 });
    expect(history.canUndo).toBe(false);
    history.record({ count: 0 }, { count: 1 });
    history.undo();
    history.record({ count: 0 }, { count: 0 }, 'count');
    expect(history.canUndo).toBe(false);
    expect(history.redo()).toEqual({ count: 1 });
  });

  it('discards redo when a new edit creates a branch', () => {
    const history = new EditHistory<number>();
    history.record(0, 1);
    history.record(1, 2);
    history.undo();
    history.record(1, 3);
    expect(history.canRedo).toBe(false);
    expect(history.redo()).toBeUndefined();
    expect(history.undo()).toBe(1);
    expect(history.undo()).toBe(0);
    expect(history.redo()).toBe(1);
    expect(history.redo()).toBe(3);
  });

  it('groups one continuous edit and closes it at explicit boundaries', () => {
    const history = new EditHistory<number>();
    history.record(10, 11, 'height');
    history.record(11, 12, 'height');
    history.record(12, 14, 'height');
    history.breakGroup();
    history.record(14, 15, 'height');
    expect(history.undo()).toBe(14);
    expect(history.undo()).toBe(10);
    expect(history.redo()).toBe(14);
    expect(history.redo()).toBe(15);
  });

  it('removes an edit when its gesture returns to the original value', () => {
    const history = new EditHistory<number>();
    history.record(0, 1);
    history.record(1, 2, 'height');
    history.record(2, 3, 'height');
    history.record(3, 1, 'height');
    expect(history.undo()).toBe(0);
    expect(history.canUndo).toBe(false);
    expect(history.redo()).toBe(1);
    expect(history.canRedo).toBe(false);
  });

  it('does not merge separate groups, discrete edits, or discontinuous state', () => {
    const history = new EditHistory<number>();
    history.record(0, 1, 'height');
    history.record(1, 2, 'width');
    history.record(2, 3);
    history.record(3, 4, 'width');
    history.record(8, 9, 'width');
    expect(history.undo()).toBe(8);
    expect(history.undo()).toBe(3);
    expect(history.undo()).toBe(2);
    expect(history.undo()).toBe(1);
    expect(history.undo()).toBe(0);
  });

  it('starts a new group after undo or redo', () => {
    const history = new EditHistory<number>();
    history.record(0, 1, 'height');
    history.breakGroup();
    history.record(1, 2, 'height');
    history.undo();
    history.record(1, 3, 'height');
    expect(history.undo()).toBe(1);
    expect(history.redo()).toBe(3);
    history.record(3, 4, 'height');
    expect(history.undo()).toBe(3);
    expect(history.undo()).toBe(1);
    expect(history.undo()).toBe(0);
  });

  it('isolates stored snapshots from inputs and undo/redo results', () => {
    const history = new EditHistory<{ layers: { name: string }[] }>();
    const before = { layers: [{ name: 'Original' }] };
    const after = { layers: [{ name: 'Renamed' }] };
    history.record(before, after);
    before.layers[0].name = 'Changed input';
    after.layers.push({ name: 'Extra layer' });
    const undone = history.undo()!;
    expect(undone).toEqual({ layers: [{ name: 'Original' }] });
    undone.layers[0].name = 'Changed undo result';
    const redone = history.redo()!;
    expect(redone).toEqual({ layers: [{ name: 'Renamed' }] });
    redone.layers[0].name = 'Changed redo result';
    expect(history.undo()).toEqual({ layers: [{ name: 'Original' }] });
    expect(history.redo()).toEqual({ layers: [{ name: 'Renamed' }] });
  });

  it('caps the undo depth while keeping remaining redo transitions', () => {
    const history = new EditHistory<number>(undefined, 2);
    history.record(0, 1);
    history.record(1, 2);
    history.record(2, 3);
    expect(history.undo()).toBe(2);
    expect(history.undo()).toBe(1);
    expect(history.undo()).toBeUndefined();
    expect(history.redo()).toBe(2);
    expect(history.redo()).toBe(3);
    history.record(3, 4);
    expect(history.undo()).toBe(3);
    expect(history.undo()).toBe(2);
    expect(history.undo()).toBeUndefined();
  });

  it('uses custom equality to exclude view-only changes', () => {
    const history = new EditHistory<{ value: number; layer: number }>((a, b) => a.value === b.value);
    history.record({ value: 1, layer: 0 }, { value: 1, layer: 1 });
    expect(history.canUndo).toBe(false);
    history.record({ value: 1, layer: 1 }, { value: 2, layer: 1 }, 'value');
    history.record({ value: 2, layer: 0 }, { value: 3, layer: 0 }, 'value');
    expect(history.undo()).toEqual({ value: 1, layer: 1 });
    expect(history.redo()).toEqual({ value: 3, layer: 0 });
  });

  it('clears both branches and the active group for a different project', () => {
    const history = new EditHistory<number>();
    history.record(0, 1, 'height');
    history.breakGroup();
    history.record(1, 2, 'height');
    history.undo();
    history.clear();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    history.record(20, 21, 'height');
    expect(history.undo()).toBe(20);
    expect(history.undo()).toBeUndefined();
  });
});
