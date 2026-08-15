import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reactHarness, reactMock } = vi.hoisted(() => {
  const harness = {
    cursor: 0,
    refs: [] as Array<{ current: unknown }>,
  };
  return {
    reactHarness: harness,
    reactMock: {
      useRef(initial: unknown) {
        const index = harness.cursor++;
        if (!harness.refs[index]) {
          harness.refs[index] = { current: initial };
        }
        return harness.refs[index];
      },
      useEffect(effect: () => void) {
        effect();
      },
    },
  };
});

vi.mock('react', () => reactMock);
vi.mock('../extensions/console/node_modules/react/index.js', () => reactMock);

import { useQueuedMessageHandoff } from '../extensions/console/src/hooks/use-queued-message-handoff.js';

interface RenderOptions {
  isGenerating: boolean;
  paused?: boolean;
  queueSize?: number;
  dequeue: () => { id: string; text: string; createdAt: number } | undefined;
  onSubmit: (text: string) => void;
}

function renderHandoff(options: RenderOptions): void {
  reactHarness.cursor = 0;
  useQueuedMessageHandoff({
    isGenerating: options.isGenerating,
    paused: options.paused ?? false,
    queueSize: options.queueSize ?? 1,
    dequeue: options.dequeue,
    onSubmit: options.onSubmit,
  });
}

describe('Console queued message handoff', () => {
  beforeEach(() => {
    reactHarness.cursor = 0;
    reactHarness.refs.length = 0;
  });

  it('hands off a queued message once when manual compact returns to idle', () => {
    const dequeue = vi.fn(() => ({
      id: 'queued-1',
      text: 'after compact',
      createdAt: 1,
    }));
    const onSubmit = vi.fn();

    renderHandoff({ isGenerating: true, dequeue, onSubmit });
    expect(dequeue).not.toHaveBeenCalled();

    renderHandoff({ isGenerating: false, dequeue, onSubmit });
    expect(dequeue).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('after compact');

    // onSubmit 设置 generating=true 的 React 更新落地前，不得重复交接。
    renderHandoff({ isGenerating: false, dequeue, onSubmit });
    expect(dequeue).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not hand off when compact completes inside a still-running turn', () => {
    const dequeue = vi.fn();
    const onSubmit = vi.fn();

    renderHandoff({ isGenerating: true, dequeue, onSubmit });

    expect(dequeue).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps queue-list paused and resumes after leaving it', () => {
    const dequeue = vi.fn(() => ({
      id: 'queued-1',
      text: 'send after closing queue',
      createdAt: 1,
    }));
    const onSubmit = vi.fn();

    renderHandoff({ isGenerating: false, paused: true, dequeue, onSubmit });
    expect(onSubmit).not.toHaveBeenCalled();

    renderHandoff({ isGenerating: false, paused: false, dequeue, onSubmit });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith('send after closing queue');
  });

  it('also resumes queued input after a failed foreground operation becomes idle', () => {
    const dequeue = vi.fn(() => ({
      id: 'queued-1',
      text: 'continue despite compact failure',
      createdAt: 1,
    }));
    const onSubmit = vi.fn();

    renderHandoff({ isGenerating: true, dequeue, onSubmit });
    renderHandoff({ isGenerating: false, dequeue, onSubmit });

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith('continue despite compact failure');
  });
});
