import { DateTime, IANAZone } from 'luxon';
import { ValidationError } from './errors.js';

export interface QuietHoursProps {
  /** Local-time minutes from midnight, inclusive start. Range 0..1439. */
  readonly startMinutes: number;
  /** Local-time minutes from midnight, exclusive end. Range 0..1439. */
  readonly endMinutes: number;
  /** IANA timezone identifier (e.g. `Europe/Moscow`). */
  readonly timezone: string;
}

/**
 * Immutable value object representing a daily "quiet hours" interval.
 *
 * Semantics:
 *  - `[start, end)` half-open in local time of `timezone`.
 *  - Wrap-around is supported: when `start > end`, the interval spans midnight.
 *  - `start === end` denotes the empty interval (never contains any instant).
 *  - Containment is evaluated against the local projection of a UTC instant,
 *    which is DST-correct thanks to Luxon.
 */
export class QuietHours {
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly timezone: string;

  private constructor(props: QuietHoursProps) {
    this.startMinutes = props.startMinutes;
    this.endMinutes = props.endMinutes;
    this.timezone = props.timezone;
  }

  static fromMinutes(props: QuietHoursProps): QuietHours {
    QuietHours.assertMinutes(props.startMinutes, 'startMinutes');
    QuietHours.assertMinutes(props.endMinutes, 'endMinutes');
    if (!IANAZone.isValidZone(props.timezone)) {
      throw new ValidationError(`Invalid IANA timezone: ${props.timezone}`);
    }
    return new QuietHours(props);
  }

  static fromHHMM(start: string, end: string, timezone: string): QuietHours {
    return QuietHours.fromMinutes({
      startMinutes: QuietHours.parseHHMM(start, 'start'),
      endMinutes: QuietHours.parseHHMM(end, 'end'),
      timezone,
    });
  }

  /** Does the UTC `instant` fall inside the configured quiet interval? */
  containsInstant(instant: Date): boolean {
    if (this.startMinutes === this.endMinutes) {
      return false;
    }
    const local = DateTime.fromJSDate(instant, { zone: this.timezone });
    if (!local.isValid) {
      throw new ValidationError(`Cannot project instant to zone ${this.timezone}`);
    }
    const m = local.hour * 60 + local.minute;
    if (this.startMinutes < this.endMinutes) {
      return m >= this.startMinutes && m < this.endMinutes;
    }
    // wrap-around: [start, 24:00) ∪ [00:00, end)
    return m >= this.startMinutes || m < this.endMinutes;
  }

  toHHMM(): { start: string; end: string; timezone: string } {
    return {
      start: QuietHours.minutesToHHMM(this.startMinutes),
      end: QuietHours.minutesToHHMM(this.endMinutes),
      timezone: this.timezone,
    };
  }

  private static parseHHMM(value: string, field: string): number {
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
    if (!m) {
      throw new ValidationError(`Invalid ${field}: ${value} (expected HH:mm, 00:00..23:59)`);
    }
    return Number(m[1]) * 60 + Number(m[2]);
  }

  private static minutesToHHMM(minutes: number): string {
    const h = Math.floor(minutes / 60)
      .toString()
      .padStart(2, '0');
    const mm = (minutes % 60).toString().padStart(2, '0');
    return `${h}:${mm}`;
  }

  private static assertMinutes(minutes: number, field: string): void {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439) {
      throw new ValidationError(`${field} must be an integer in 0..1439`);
    }
  }
}
