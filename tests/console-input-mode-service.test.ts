import { describe, expect, it, vi } from 'vitest';
import { createConsoleSlashCommandService } from '../extensions/console/src/slash-command-service.js';

describe('Console session input modes', () => {
  it('resolves by session and priority, then dispatches only to the active provider', async () => {
    const service = createConsoleSlashCommandService();
    const handled: string[] = [];
    service.registerInputMode({
      id: 'low', priority: 10,
      getSnapshot: ({ sessionId }) => sessionId === 's1' ? { id: 'low', label: 'Low' } : undefined,
      handle: ({ text }) => { handled.push(`low:${text}`); return { message: 'low' }; },
    });
    service.registerInputMode({
      id: 'high', priority: 20,
      getSnapshot: ({ sessionId }) => sessionId === 's1' ? { id: 'high', label: 'High' } : undefined,
      handle: ({ text }) => { handled.push(`high:${text}`); return { message: 'high' }; },
    });

    expect(service.resolveInputMode({ sessionId: 's1' })?.id).toBe('high');
    expect(service.resolveInputMode({ sessionId: 's2' })).toBeUndefined();
    expect(await service.dispatchInput({ sessionId: 's1', text: 'task' })).toEqual({ message: 'high' });
    expect(await service.dispatchInput({ sessionId: 's2', text: 'task' })).toBeUndefined();
    expect(handled).toEqual(['high:task']);
  });

  it('relays provider state changes and detaches the relay on disposal', () => {
    const service = createConsoleSlashCommandService();
    let notify = () => {};
    const listener = vi.fn();
    service.onDidChange(listener);
    const registration = service.registerInputMode({
      id: 'mode',
      getSnapshot: () => undefined,
      handle: () => undefined,
      onDidChange(next) { notify = next; return { dispose: () => { notify = () => {}; } }; },
    });
    const afterRegister = listener.mock.calls.length;
    notify();
    expect(listener.mock.calls.length).toBe(afterRegister + 1);
    registration.dispose();
    const afterDispose = listener.mock.calls.length;
    notify();
    expect(listener.mock.calls.length).toBe(afterDispose);
  });
});
