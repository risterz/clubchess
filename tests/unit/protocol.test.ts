import { describe, expect, it } from 'vitest';
import {
  generateRoomId,
  isValidRoomId,
  parseClientRoomMessage,
} from '../../src/shared/protocol';
import { formatClockMs, isTimeControlId } from '../../src/shared/time-controls';

describe('time-controls', () => {
  it('validates supported time controls', () => {
    expect(isTimeControlId('3+2')).toBe(true);
    expect(isTimeControlId('unlimited')).toBe(true);
    expect(isTimeControlId('15+10')).toBe(false);
  });

  it('formats standard and sub-20s tenths clock values', () => {
    expect(formatClockMs(180_000)).toBe('3:00');
    expect(formatClockMs(65_000)).toBe('1:05');
    expect(formatClockMs(19_450)).toBe('0:19.4');
    expect(formatClockMs(0)).toBe('0:00.0');
  });
});

describe('protocol', () => {
  it('generates valid 6-char unambiguous room IDs', () => {
    for (let i = 0; i < 20; i++) {
      const id = generateRoomId();
      expect(id).toHaveLength(6);
      expect(isValidRoomId(id)).toBe(true);
    }
    expect(isValidRoomId('abc123')).toBe(false);
    expect(isValidRoomId('O01ILX')).toBe(false);
  });

  it('parses valid client room messages and rejects malformed payloads', () => {
    expect(
      parseClientRoomMessage(JSON.stringify({ type: 'move', from: 'e2', to: 'e4', seq: 1 })),
    ).toEqual({ type: 'move', from: 'e2', to: 'e4', seq: 1 });
    expect(parseClientRoomMessage('not-json')).toBeNull();
    expect(parseClientRoomMessage(JSON.stringify({ type: 'move', from: 123 }))).toBeNull();
    expect(parseClientRoomMessage(JSON.stringify({ type: 'unknown' }))).toBeNull();
  });
});
