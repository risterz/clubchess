export type TimeControlId = '1+0' | '3+0' | '3+2' | '5+0' | '10+0' | 'unlimited';

export interface TimeControlConfig {
  id: TimeControlId;
  label: string;
  category: 'Bullet' | 'Blitz' | 'Rapid' | 'Casual';
  initialMs: number;
  incrementMs: number;
}

export const TIME_CONTROLS: Record<TimeControlId, TimeControlConfig> = {
  '1+0': { id: '1+0', label: '1+0', category: 'Bullet', initialMs: 60_000, incrementMs: 0 },
  '3+0': { id: '3+0', label: '3+0', category: 'Blitz', initialMs: 180_000, incrementMs: 0 },
  '3+2': { id: '3+2', label: '3+2', category: 'Blitz', initialMs: 180_000, incrementMs: 2_000 },
  '5+0': { id: '5+0', label: '5+0', category: 'Blitz', initialMs: 300_000, incrementMs: 0 },
  '10+0': { id: '10+0', label: '10+0', category: 'Rapid', initialMs: 600_000, incrementMs: 0 },
  unlimited: { id: 'unlimited', label: 'Unlimited', category: 'Casual', initialMs: 0, incrementMs: 0 },
};

export const TIME_CONTROL_LIST: TimeControlConfig[] = Object.values(TIME_CONTROLS);

export function isTimeControlId(value: string): value is TimeControlId {
  return Object.prototype.hasOwnProperty.call(TIME_CONTROLS, value);
}

export function formatClockMs(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < 20_000) {
    const totalTenths = Math.floor(clamped / 100);
    const secs = Math.floor(totalTenths / 10);
    const tenths = totalTenths % 10;
    return `0:${String(secs).padStart(2, '0')}.${tenths}`;
  }
  const totalSeconds = Math.ceil(clamped / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
