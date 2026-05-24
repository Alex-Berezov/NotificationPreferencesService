import { describe, it, expect } from 'vitest';
import { QuietHours } from '../../src/domain/quietHours.js';
import { ValidationError } from '../../src/domain/errors.js';

describe('QuietHours.fromMinutes / fromHHMM', () => {
  it('accepts boundary values 0 and 1439', () => {
    expect(() =>
      QuietHours.fromMinutes({ startMinutes: 0, endMinutes: 1439, timezone: 'UTC' }),
    ).not.toThrow();
  });

  it('rejects out-of-range minutes', () => {
    expect(() =>
      QuietHours.fromMinutes({ startMinutes: -1, endMinutes: 60, timezone: 'UTC' }),
    ).toThrow(ValidationError);
    expect(() =>
      QuietHours.fromMinutes({ startMinutes: 0, endMinutes: 1440, timezone: 'UTC' }),
    ).toThrow(ValidationError);
  });

  it('rejects non-integer minutes', () => {
    expect(() =>
      QuietHours.fromMinutes({ startMinutes: 1.5, endMinutes: 60, timezone: 'UTC' }),
    ).toThrow(ValidationError);
  });

  it('rejects invalid IANA timezone', () => {
    expect(() =>
      QuietHours.fromMinutes({ startMinutes: 0, endMinutes: 60, timezone: 'Not/AZone' }),
    ).toThrow(ValidationError);
  });

  it('rejects bad HH:mm strings', () => {
    expect(() => QuietHours.fromHHMM('24:00', '08:00', 'UTC')).toThrow(ValidationError);
    expect(() => QuietHours.fromHHMM('22:60', '08:00', 'UTC')).toThrow(ValidationError);
    expect(() => QuietHours.fromHHMM('7:00', '08:00', 'UTC')).toThrow(ValidationError);
  });

  it('round-trips through toHHMM', () => {
    const qh = QuietHours.fromHHMM('22:30', '07:15', 'Europe/Berlin');
    expect(qh.toHHMM()).toEqual({ start: '22:30', end: '07:15', timezone: 'Europe/Berlin' });
  });
});

describe('QuietHours.containsInstant', () => {
  it('non-wrap [09:00, 17:00) — half-open semantics', () => {
    const qh = QuietHours.fromHHMM('09:00', '17:00', 'UTC');
    // 08:59:59Z — outside
    expect(qh.containsInstant(new Date('2026-05-21T08:59:59Z'))).toBe(false);
    // 09:00:00Z — inclusive start
    expect(qh.containsInstant(new Date('2026-05-21T09:00:00Z'))).toBe(true);
    // 16:59:59Z — inside
    expect(qh.containsInstant(new Date('2026-05-21T16:59:59Z'))).toBe(true);
    // 17:00:00Z — exclusive end
    expect(qh.containsInstant(new Date('2026-05-21T17:00:00Z'))).toBe(false);
  });

  it('wrap-around [22:00, 08:00) Europe/Berlin', () => {
    const qh = QuietHours.fromHHMM('22:00', '08:00', 'Europe/Berlin');
    // 2026-05-21T21:30Z = 23:30 Berlin (CEST, UTC+2) — inside
    expect(qh.containsInstant(new Date('2026-05-21T21:30:00Z'))).toBe(true);
    // 2026-05-21T06:30Z = 08:30 Berlin — outside (just past end)
    expect(qh.containsInstant(new Date('2026-05-21T06:30:00Z'))).toBe(false);
    // 2026-05-21T05:30Z = 07:30 Berlin — inside
    expect(qh.containsInstant(new Date('2026-05-21T05:30:00Z'))).toBe(true);
    // 2026-05-21T19:00Z = 21:00 Berlin — outside (just before start)
    expect(qh.containsInstant(new Date('2026-05-21T19:00:00Z'))).toBe(false);
  });

  it('empty interval (start === end) never contains any instant', () => {
    const qh = QuietHours.fromHHMM('12:00', '12:00', 'UTC');
    expect(qh.containsInstant(new Date('2026-05-21T12:00:00Z'))).toBe(false);
    expect(qh.containsInstant(new Date('2026-05-21T11:59:59Z'))).toBe(false);
    expect(qh.containsInstant(new Date('2026-05-21T00:00:00Z'))).toBe(false);
  });

  it('DST spring-forward (Europe/Berlin 2026-03-29): 02:00 local does not exist', () => {
    // CET→CEST jump: 01:59:59 +01 → 03:00:00 +02 on 2026-03-29
    const qh = QuietHours.fromHHMM('01:30', '02:30', 'Europe/Berlin');
    // 00:45Z = 01:45 +01 — inside (before jump)
    expect(qh.containsInstant(new Date('2026-03-29T00:45:00Z'))).toBe(true);
    // 01:30Z = 03:30 +02 — outside (after jump, past the [01:30, 02:30) window)
    expect(qh.containsInstant(new Date('2026-03-29T01:30:00Z'))).toBe(false);
  });

  it('DST fall-back (Europe/Berlin 2026-10-25): 02:30 occurs twice', () => {
    // CEST→CET fall-back: 02:59:59 +02 → 02:00:00 +01 on 2026-10-25
    const qh = QuietHours.fromHHMM('02:00', '03:00', 'Europe/Berlin');
    // 00:30Z = 02:30 +02 (first occurrence, before fall-back) — inside
    expect(qh.containsInstant(new Date('2026-10-25T00:30:00Z'))).toBe(true);
    // 01:30Z = 02:30 +01 (second occurrence, after fall-back) — inside
    expect(qh.containsInstant(new Date('2026-10-25T01:30:00Z'))).toBe(true);
    // 02:30Z = 03:30 +01 — outside
    expect(qh.containsInstant(new Date('2026-10-25T02:30:00Z'))).toBe(false);
  });

  it('UTC start exactly at midnight wrap-around', () => {
    const qh = QuietHours.fromHHMM('00:00', '06:00', 'UTC');
    expect(qh.containsInstant(new Date('2026-05-21T00:00:00Z'))).toBe(true);
    expect(qh.containsInstant(new Date('2026-05-21T05:59:59Z'))).toBe(true);
    expect(qh.containsInstant(new Date('2026-05-21T06:00:00Z'))).toBe(false);
  });
});
