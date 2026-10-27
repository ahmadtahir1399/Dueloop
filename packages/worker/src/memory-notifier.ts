import type { Alert } from '@dueloop/messaging';
import type { Notifier } from './ports.ts';

/** In-memory notifier (tests, demo, and the --dry notifier of the CLI). De-duplication happens before it. */
export class MemoryNotifier implements Notifier {
  readonly alerts: Alert[] = [];
  async notify(alert: Alert): Promise<void> {
    this.alerts.push(alert);
  }
}
