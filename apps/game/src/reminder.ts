/**
 * The daily reminder.
 *
 * This existed as a settings toggle that saved a boolean and did nothing else —
 * the app told players "we'll let you know when there's a new board" and then
 * never did. A control that lies is worse than a missing feature, so it either
 * had to work or come out. It works.
 *
 * Two rules, both from ADR-006's spirit rather than its letter:
 *
 *   - **Never ask on launch.** The permission prompt appears only after the
 *     player turns the toggle on, so the ask is always something they initiated.
 *   - **One notification, at the reset.** Not a nag campaign, not a streak
 *     guilt-trip at 9pm. A new board exists; that is the whole message.
 */
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

/** Fixed id so scheduling twice replaces rather than stacks. */
const NOTIFICATION_ID = 1;

export type ReminderOutcome = 'scheduled' | 'denied' | 'unsupported';

/** Local notifications only exist in the native shell; the web build has no equivalent. */
export function isSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LocalNotifications');
}

/**
 * Asks for permission and schedules the reminder.
 *
 * Returns what actually happened so the caller can tell the player the truth
 * rather than flipping a switch and hoping.
 */
export async function enable(): Promise<ReminderOutcome> {
  if (!isSupported()) return 'unsupported';

  try {
    let status = await LocalNotifications.checkPermissions();
    if (status.display !== 'granted') {
      status = await LocalNotifications.requestPermissions();
    }
    if (status.display !== 'granted') return 'denied';

    await LocalNotifications.schedule({
      notifications: [
        {
          id: NOTIFICATION_ID,
          title: 'Hay tablero nuevo',
          body: 'El reto de hoy te espera.',
          // Fires at the UTC rollover, which is when the board actually changes.
          // Repeating daily means one schedule call, not one per day.
          schedule: { at: nextReset(), repeats: true, every: 'day', allowWhileIdle: false },
          smallIcon: 'ic_launcher_foreground',
        },
      ],
    });
    return 'scheduled';
  } catch {
    // A device that refuses to schedule is not an error worth surfacing as a
    // crash; the toggle simply reports that it could not be turned on.
    return 'unsupported';
  }
}

export async function disable(): Promise<void> {
  if (!isSupported()) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: NOTIFICATION_ID }] });
  } catch {
    // Nothing scheduled, or the plugin is unavailable. Either way it is off.
  }
}

/**
 * Re-arms on launch when the setting says it should be on.
 *
 * Android clears scheduled notifications when an app is force-stopped or the
 * device is wiped, so a reminder that was on before can silently stop firing.
 * Re-scheduling on boot is cheap and idempotent — the fixed id replaces.
 */
export async function restore(enabled: boolean): Promise<void> {
  if (!enabled || !isSupported()) return;
  await enable();
}

/** The next midnight UTC, which is when a new daily board becomes available. */
export function nextReset(now: number = Date.now()): Date {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0));
}
