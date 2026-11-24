import { Cpu, Loader2, Swords, Users, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Color, ServerQueueMessage, SidePref } from '../../shared/protocol';
import { TIME_CONTROL_LIST, type TimeControlId } from '../../shared/time-controls';
import { AI_DIFFICULTY_LIST, type AiDifficultyId } from '../engine/stockfish';
import { saveSeatToken } from '../storage/local-store';

type LobbyTab = 'quick' | 'friend' | 'ai';

export interface LobbyProps {
  nickname: string;
  onEnterRoom: (roomId: string) => void;
  onStartSolo: (opts: { difficulty: AiDifficultyId; side: Color; timeControl: TimeControlId }) => void;
}

export function Lobby({ nickname, onEnterRoom, onStartSolo }: LobbyProps) {
  const [tab, setTab] = useState<LobbyTab>('quick');
  const [timeControl, setTimeControl] = useState<TimeControlId>('3+2');
  const [sidePref, setSidePref] = useState<SidePref>('random');
  const [difficulty, setDifficulty] = useState<AiDifficultyId>('club');
  const [searching, setSearching] = useState(false);
  const [searchSec, setSearchSec] = useState(0);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queueWsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!searching) {
      setSearchSec(0);
      return;
    }
    const id = setInterval(() => setSearchSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [searching]);

  useEffect(() => {
    return () => {
      queueWsRef.current?.close(1000, 'Unmount');
    };
  }, []);

  function startQuickMatch(): void {
    setError(null);
    setSearching(true);
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws/queue/${encodeURIComponent(timeControl)}?name=${encodeURIComponent(nickname)}`;
    const ws = new WebSocket(url);
    queueWsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ServerQueueMessage;
        if (msg.type === 'matched') {
          saveSeatToken(msg.roomId, msg.seatToken);
          setSearching(false);
          onEnterRoom(msg.roomId);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onerror = () => {
      setSearching(false);
      setError('Could not connect to matchmaking queue. Please retry.');
    };

    ws.onclose = (ev) => {
      if (ev.code !== 1000) {
        setSearching(false);
      }
    };
  }

  function cancelQuickMatch(): void {
    queueWsRef.current?.close(1000, 'Cancel');
    queueWsRef.current = null;
    setSearching(false);
  }

  async function createPrivateRoom(): Promise<void> {
    setError(null);
    setCreatingRoom(true);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeControl, sidePref, name: nickname }),
      });
      if (!res.ok) throw new Error('Failed to create room');
      const data = (await res.json()) as { roomId: string; seatToken: string };
      saveSeatToken(data.roomId, data.seatToken);
      onEnterRoom(data.roomId);
    } catch {
      setError('Unable to create room. Check connection and retry.');
    } finally {
      setCreatingRoom(false);
    }
  }

  function launchSolo(): void {
    const resolvedColor: Color =
      sidePref === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : sidePref;
    onStartSolo({ difficulty, side: resolvedColor, timeControl });
  }

  return (
    <main className="max-w-xl mx-auto px-4 py-10 sm:py-16 w-full">
      <div className="text-center mb-8">
        <h1 className="font-editorial text-4xl sm:text-5xl font-semibold tracking-tight m-0">
          Quiet board. Sharp game.
        </h1>
        <p className="text-[var(--text-secondary)] mt-3 mb-0">
          Instant online matches, private club tables, or Stockfish practice — no account required.
        </p>
      </div>

      <section className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] overflow-hidden shadow-xl">
        <div role="tablist" aria-label="Game mode" className="grid grid-cols-3 border-b border-[var(--border-subtle)]">
          {(
            [
              { id: 'quick', label: 'Quick Match', Icon: Swords },
              { id: 'friend', label: 'Play a Friend', Icon: Users },
              { id: 'ai', label: 'vs Computer', Icon: Cpu },
            ] as const
          ).map(({ id, label, Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => {
                  if (searching) cancelQuickMatch();
                  setTab(id);
                  setError(null);
                }}
                className={`min-h-[48px] px-3 flex items-center justify-center gap-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                  active
                    ? 'border-[var(--accent-primary)] text-[var(--text-primary)] bg-[var(--bg-elevated)]'
                    : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>

        <div className="p-5 sm:p-6 flex flex-col gap-5">
          {error && (
            <div role="alert" className="px-3.5 py-2.5 rounded-lg border border-[var(--danger)] text-sm text-[var(--danger)]">
              {error}
            </div>
          )}

          {/* Time Control Grid */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mt-0 mb-2">
              Time Control
            </p>
            <div className="grid grid-cols-3 gap-2">
              {TIME_CONTROL_LIST.map((tc) => {
                const selected = timeControl === tc.id;
                return (
                  <button
                    key={tc.id}
                    type="button"
                    disabled={searching}
                    onClick={() => setTimeControl(tc.id)}
                    className={`min-h-[54px] rounded-lg border flex flex-col items-center justify-center transition-colors cursor-pointer disabled:opacity-60 ${
                      selected
                        ? 'border-[var(--accent-primary)] bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
                    }`}
                  >
                    <span className="font-mono-tabular font-semibold text-base">{tc.label}</span>
                    <span className="text-[11px] opacity-80">{tc.category}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {tab === 'ai' && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mt-0 mb-2">
                Stockfish Strength
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {AI_DIFFICULTY_LIST.map((d) => {
                  const selected = difficulty === d.id;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setDifficulty(d.id)}
                      className={`min-h-[52px] rounded-lg border flex flex-col items-center justify-center cursor-pointer ${
                        selected
                          ? 'border-[var(--accent-primary)] bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                          : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
                      }`}
                    >
                      <span className="text-sm font-medium">{d.label}</span>
                      <span className="text-[11px] font-mono-tabular opacity-80">{d.eloLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {(tab === 'friend' || tab === 'ai') && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mt-0 mb-2">
                Play As
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'random', label: 'Random' },
                    { id: 'w', label: 'White' },
                    { id: 'b', label: 'Black' },
                  ] as const
                ).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSidePref(s.id)}
                    className={`min-h-[44px] rounded-lg border text-sm font-medium cursor-pointer ${
                      sidePref === s.id
                        ? 'border-[var(--accent-primary)] bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                        : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Primary CTA */}
          {tab === 'quick' &&
            (searching ? (
              <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--accent-primary)]">
                <div className="flex items-center gap-2.5">
                  <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-primary)]" strokeWidth={1.75} aria-hidden="true" />
                  <span className="text-sm font-medium">
                    Searching {timeControl}… <span className="font-mono-tabular">{searchSec}s</span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={cancelQuickMatch}
                  className="min-h-[44px] px-3 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium flex items-center gap-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden="true" /> Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={startQuickMatch}
                className="min-h-[48px] w-full rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] font-semibold text-base cursor-pointer transition-colors"
              >
                Find Opponent
              </button>
            ))}

          {tab === 'friend' && (
            <button
              type="button"
              disabled={creatingRoom}
              onClick={() => void createPrivateRoom()}
              className="min-h-[48px] w-full rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] font-semibold text-base disabled:opacity-60 cursor-pointer transition-colors"
            >
              {creatingRoom ? 'Creating Room…' : 'Create Private Table'}
            </button>
          )}

          {tab === 'ai' && (
            <button
              type="button"
              onClick={launchSolo}
              className="min-h-[48px] w-full rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] font-semibold text-base cursor-pointer transition-colors"
            >
              Start Practice Match
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
