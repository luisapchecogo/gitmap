import { GraphSink } from '../../graph/graphController';
import { HostMessage } from '../../shared/protocol';

/** Records what a GraphController sends to its webview. */
export class RecordingSink implements GraphSink {
  readonly messages: HostMessage[] = [];

  post(message: HostMessage): void {
    this.messages.push(message);
  }

  lastReset(): Extract<HostMessage, { type: 'reset' }> | undefined {
    const resets = this.messages.filter((m): m is Extract<HostMessage, { type: 'reset' }> => m.type === 'reset');
    return resets[resets.length - 1];
  }

  /** Waits until a message matching `predicate` arrives. */
  async waitFor(predicate: (message: HostMessage) => boolean, timeoutMs = 5000): Promise<HostMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages.find(predicate);
      if (found) {
        return found;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for a message; got ${JSON.stringify(this.messages.map((m) => m.type))}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}
