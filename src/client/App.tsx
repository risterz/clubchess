import { Chess } from 'chess.js';
import { ArrowLeft, Copy } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Color, MoveRecord } from '../shared/protocol';
import type { TimeControlId } from '../shared/time-controls';
import { ChessBoard } from './components/ChessBoard';
import { Header } from './components/Header';
import { HistoryDrawer } from './components/HistoryDrawer';
import { Lobby } from './components/Lobby';
import { MatchArena } from './components/MatchArena';
import { MoveList } from './components/MoveList';
import { StockfishWorkerEngine, type AiDifficultyId } from './engine/stockfish';
import { LocalAISession } from './session/local-ai';
import { MultiplayerSession } from './session/multiplayer';
import type { GameSession, GameSessionState } from './session/types';
import {
  appendHistory,
  loadHistory,
  loadPrefs,
  savePrefs,
  type SavedGame,
  type UserPrefs,
} from './storage/local-store';

type Route =
  | { kind: 'lobby' }
  | { kind: 'room'; roomId: string }
  | { kind: 'solo'; difficulty: AiDifficultyId; side: Color; timeControl: TimeControlId; key: number }
  | { kind: 'replay'; game: SavedGame };

const STARTING_FEN = new Chess().fen();

function parseInitialRoute(savedGames: SavedGame[]): Route {
  const roomMatch = window.location.pathname.match(/^\/room\/([A-Za-z0-9]{6})\/?$/);
  if (roomMatch) return { kind: 'room', roomId: roomMatch[1].toUpperCase() };

  const replayMatch = window.location.pathname.match(/^\/replay\/([^/]+)\/?$/);
  if (replayMatch) {
    try {
      const id = decodeURIComponent(replayMatch[1]);
      const found = savedGames.find((g) => g.id === id);
      if (found) return { kind: 'replay', game: found };
    } catch {
      return { kind: 'lobby' };
    }
  }

  return { kind: 'lobby' };
}

function ReplayView({ game, onBack }: { game: SavedGame; onBack: () => void }) {
  const moves = useMemo<MoveRecord[]>(() => {
    const replay = new Chess();
    try {
      replay.loadPgn(game.pgn);
    } catch {
      return [];
    }
    const history = replay.history({ verbose: true });
    const step = new Chess();
    return history.map((m) => {
      step.move(m);
      return {
        san: m.san,
        uci: `${m.from}${m.to}${m.promotion ?? ''}`,
        fen: step.fen(),
        wMs: 0,
        bMs: 0,
      };
    });
  }, [game.pgn]);

  const [ply, setPly] = useState(moves.length);
  const currentMove = ply > 0 ? moves[ply - 1] : null;
  const fen = ply === 0 ? STARTING_FEN : currentMove?.fen ?? game.finalFen;
  const lastMove = currentMove
    ? { from: currentMove.uci.slice(0, 2), to: currentMove.uci.slice(2, 4) }
    : null;

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 w-full">
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] px-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm flex items-center gap-1.5 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> Back to Lobby
        </button>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(game.pgn).catch(() => {})}
          className="min-h-[44px] px-3.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm flex items-center gap-1.5 cursor-pointer"
        >
          <Copy className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> Copy PGN
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,640px)_340px] gap-6 justify-center items-start">
        <div className="w-full max-w-[min(78dvh,640px)] mx-auto">
          <ChessBoard
            fen={fen}
            orientation={game.userColor}
            interactive={false}
            allowedColor={null}
            lastMove={lastMove}
            onMove={() => {}}
          />
        </div>
        <aside className="flex flex-col gap-3">
          <div className="p-3.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
            <p className="font-medium m-0">
              {game.whiteName} vs {game.blackName}
            </p>
            <p className="text-xs text-[var(--text-secondary)] font-mono-tabular mt-1 mb-0">
              {game.timeControl} ·{' '}
              {game.result.winner === 'draw'
                ? 'Draw'
                : `${game.result.winner === 'w' ? 'White' : 'Black'} wins`}{' '}
              ({game.result.reason})
            </p>
          </div>
          <MoveList moves={moves} viewPly={ply} onSelectPly={setPly} />
        </aside>
      </div>
    </main>
  );
}

export function App() {
  const [prefs, setPrefs] = useState<UserPrefs>(() => loadPrefs());
  const [history, setHistory] = useState<SavedGame[]>(() => loadHistory());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [route, setRoute] = useState<Route>(() => parseInitialRoute(loadHistory()));
  const nicknameRef = useRef(prefs.nickname);
  nicknameRef.current = prefs.nickname;
  const historyRef = useRef(history);
  historyRef.current = history;

  useEffect(() => {
    document.documentElement.dataset.theme = prefs.uiTheme;
    document.documentElement.dataset.board = prefs.boardTheme;
    savePrefs(prefs);
  }, [prefs]);

  useEffect(() => {
    const onPop = () => setRoute(parseInitialRoute(historyRef.current));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const updatePrefs = useCallback((patch: Partial<UserPrefs>) => {
    setPrefs((prev) => ({ ...prev, ...patch }));
  }, []);

  const navigateLobby = useCallback(() => {
    window.history.pushState(null, '', '/');
    setRoute({ kind: 'lobby' });
  }, []);

  const navigateRoom = useCallback((roomId: string) => {
    window.history.pushState(null, '', `/room/${roomId}`);
    setRoute({ kind: 'room', roomId });
  }, []);

  const navigateReplay = useCallback((game: SavedGame) => {
    window.history.pushState(null, '', `/replay/${encodeURIComponent(game.id)}`);
    setRoute({ kind: 'replay', game });
  }, []);

  const handleGameEnd = useCallback((state: GameSessionState, pgn: string) => {
    if (!state.result || state.yourRole === 'spectator') return;
    const saved: SavedGame = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      mode: state.mode,
      playedAt: Date.now(),
      timeControl: state.timeControl,
      whiteName: state.players.w?.name ?? 'White',
      blackName: state.players.b?.name ?? 'Black',
      userColor: state.yourRole,
      result: state.result,
      pgn,
      finalFen: state.fen,
    };
    setHistory(appendHistory(saved));
  }, []);

  const createSession = useMemo<(() => GameSession) | null>(() => {
    if (route.kind === 'room') {
      const { roomId } = route;
      return () =>
        new MultiplayerSession({
          roomId,
          playerName: nicknameRef.current,
          onGameEnd: handleGameEnd,
        });
    }
    if (route.kind === 'solo') {
      const { side, difficulty, timeControl } = route;
      return () =>
        new LocalAISession(
          {
            playerName: nicknameRef.current,
            playerColor: side,
            difficulty,
            timeControl,
            onGameEnd: handleGameEnd,
          },
          new StockfishWorkerEngine(),
        );
    }
    return null;
  }, [route, handleGameEnd]);

  return (
    <div className="min-h-dvh flex flex-col">
      <Header
        prefs={prefs}
        historyCount={history.length}
        onUpdatePrefs={updatePrefs}
        onOpenHistory={() => setHistoryOpen(true)}
        onGoHome={navigateLobby}
      />

      {route.kind === 'lobby' && (
        <Lobby
          nickname={prefs.nickname}
          onEnterRoom={navigateRoom}
          onStartSolo={(opts) => {
            window.history.pushState(null, '', '/solo');
            setRoute({ kind: 'solo', ...opts, key: Date.now() });
          }}
        />
      )}

      {createSession && (route.kind === 'room' || route.kind === 'solo') && (
        <MatchArena
          key={route.kind === 'room' ? route.roomId : `solo-${route.key}`}
          createSession={createSession}
          soundEnabled={prefs.soundEnabled}
          onToggleSound={() => updatePrefs({ soundEnabled: !prefs.soundEnabled })}
          onReturnLobby={navigateLobby}
        />
      )}

      {route.kind === 'replay' && (
        <ReplayView key={route.game.id} game={route.game} onBack={navigateLobby} />
      )}

      <HistoryDrawer
        open={historyOpen}
        games={history}
        onClose={() => setHistoryOpen(false)}
        onSelectGame={navigateReplay}
      />
    </div>
  );
}
