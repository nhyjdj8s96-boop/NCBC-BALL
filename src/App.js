import { useState, useCallback, useEffect, useRef } from "react";

const TEAM_SIZE = 5;
const ADMIN_PIN = "1234";
const ADMIN_TIMEOUT = 40_000; // 10s idle + 30s countdown
const LONG_PRESS_MS = 600;
let _uid = 1;
const uid = () => _uid++;

function initPlayer(name, joinOrder) {
  return { id: uid(), name, joinOrder, roundsWaited: 0, gamesPlayed: 0, winStreak: 0, hasPlayed: false, streakedOut: false };
}

function sortQueue(players) {
  // Compute average gamesPlayed among players who HAVE played, within this
  // specific group being sorted — not the whole session. New players (never
  // played) don't count toward the average since they already get top priority.
  const experienced = players.filter(p => p.hasPlayed);
  const avgGamesPlayed = experienced.length > 0
    ? experienced.reduce((sum, p) => sum + (p.gamesPlayed || 0), 0) / experienced.length
    : 0;

  // Cap the catch-up boost at the longest actual roundsWaited in the pool —
  // a deficit can help someone catch up faster, but it can never let them
  // cut in front of someone who has genuinely waited longer in the queue.
  const maxRoundsWaited = experienced.length > 0
    ? Math.max(...experienced.map(p => p.roundsWaited))
    : 0;

  const effectiveWait = (p) => {
    const deficit = avgGamesPlayed - (p.gamesPlayed || 0);
    const rawBoost = deficit > 0 ? deficit : 0;
    const boost = Math.min(rawBoost, maxRoundsWaited);
    return p.roundsWaited + boost;
  };

  // Stable random tiebreaker: derive a pseudo-random value from each player's
  // id so repeated sorts on the same data produce the same order (no flicker
  // between renders), while still feeling random across different players.
  const randomSeed = (p) => {
    let h = p.id * 2654435761 % 2147483647;
    return h / 2147483647;
  };

  return [...players].sort((a, b) => {
    const aNew = !a.hasPlayed, bNew = !b.hasPlayed;
    if (aNew && !bNew) return -1;
    if (!aNew && bNew) return 1;
    if (aNew && bNew) return a.joinOrder - b.joinOrder;
    const aWait = effectiveWait(a);
    const bWait = effectiveWait(b);
    if (bWait !== aWait) return bWait - aWait;
    if ((a.gamesPlayed || 0) !== (b.gamesPlayed || 0)) return (a.gamesPlayed || 0) - (b.gamesPlayed || 0);
    // Fully tied on wait time and games played — break the tie with a stable
    // pseudo-random value instead of always favoring whoever joined first.
    return randomSeed(a) - randomSeed(b);
  });
}

// When a player re-enters the queue (sub-out/leave), don't dump them to the very
// back — give them roundsWaited matching the current queue leader so they compete
// fairly on gamesPlayed instead of being automatically last.
function fairRoundsWaited(queue) {
  const sorted = sortQueue(queue);
  return sorted.length > 0 ? sorted[0].roundsWaited : 0;
}

function pickNextTeam(pool) {
  const sorted = sortQueue(pool);
  return {
    nextTeam: sorted.slice(0, TEAM_SIZE).map(p => ({ ...p, hasPlayed: true })),
    bench: sorted.slice(TEAM_SIZE),
  };
}

const VIEWS = { SETUP: "setup", GAME: "game" };
const ZONES = { TEAM_A: "teamA", TEAM_B: "teamB", QUEUE: "queue", SITTING: "sitting", LEFT: "left" };
const ZONE_LABELS = { teamA: "Team A", teamB: "Team B", queue: "Queue", sitting: "Sitting Out", left: "Left" };
const TIMER_DURATION = 8 * 60;

// Saved roster — tap to quickly add instead of typing. Names disappear from
// the picker once added to setup, and reappear if removed.
const KNOWN_PLAYERS = [
  "Josh Kim", "John Kim", "Josh Wong", "Sherif Wilson", "Jeff Park",
  "Melvin George", "Alex Chiew", "Pastor Jacob Halle", "Gabe Halle", "Nathan Samara",
  "Josh Aurdos", "Donny Hua", "Chris Demas", "Mark Nagrampa", "Freddy Bongiorno",
  "Brandon Lee", "Brianna Chun", "Matt Kim", "Daniel Kim", "Luke Li",
  "Brian Ho", "Josué George", "Sam Livermore", "Pastor James Choi",
];

const STORAGE_KEY = "nextgame_v1";

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export default function App() {
  const saved = loadSaved();

  // Auth
  const [isAdmin, setIsAdmin] = useState(false);
  const [pinModal, setPinModal] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
  const adminTimerRef = useRef(null);
  const adminCountdownRef = useRef(null);
  const lastActivityRef = useRef(Date.now());
  const [adminCountdown, setAdminCountdown] = useState(null);

  // Views
  const [view, setView] = useState(saved?.view ?? VIEWS.SETUP);
  const [nameInput, setNameInput] = useState("");
  const [setupPlayers, setSetupPlayers] = useState(saved?.setupPlayers ?? []);
  const [joinCounter, setJoinCounter] = useState(saved?.joinCounter ?? 0);

  // Game state — restored from localStorage if available
  const [teamA, setTeamA] = useState(saved?.teamA ?? []);
  const [teamB, setTeamB] = useState(saved?.teamB ?? []);
  const [queue, setQueue] = useState(saved?.queue ?? []);
  const [sittingOut, setSittingOut] = useState(saved?.sittingOut ?? []);
  const [left, setLeft] = useState(saved?.left ?? []);
  const [gameCount, setGameCount] = useState(saved?.gameCount ?? 1);
  const [lastResult, setLastResult] = useState(saved?.lastResult ?? null);
  const [history, setHistory] = useState(saved?.history ?? []);
  const [subModal, setSubModal] = useState(null);
  const [swapMode, setSwapMode] = useState(null);
  const [lastWinner, setLastWinner] = useState(null);
  const [animKey, setAnimKey] = useState(0);
  const [confirmModal, setConfirmModal] = useState(null);
  const [moveConfirm, setMoveConfirm] = useState(null);
  const [endSessionConfirm, setEndSessionConfirm] = useState(false);
  const [dupeWarning, setDupeWarning] = useState(null); // name string or null

  // Pick-up state
  const [pickedUp, setPickedUp] = useState(null);

  // ── PERSIST TO LOCALSTORAGE ───────────────────────────────────────────────
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        view, setupPlayers, joinCounter,
        teamA, teamB, queue, sittingOut, left,
        gameCount, lastResult, history,
      }));
    } catch { /* storage full or unavailable */ }
  }, [view, setupPlayers, joinCounter, teamA, teamB, queue, sittingOut,
      left, gameCount, lastResult, history]);

  // ── GAME TIMER ────────────────────────────────────────────────────────────
  const [timerSeconds, setTimerSeconds] = useState(TIMER_DURATION);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerDone, setTimerDone] = useState(false);
  const lastAnnouncedMinute = useRef(null);
  const timerRef = useRef(null);

  const audioCtxRef = useRef(null);

  // Initialise AudioContext on first user interaction so it's ready for the buzzer
  const ensureAudioCtx = () => {
    // Pre-load voices on first interaction
    if (window.speechSynthesis && window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.getVoices();
    }
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  const speak = (text) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    u.pitch = 1;
    u.volume = 1;
    window.speechSynthesis.speak(u);
  };

  const buzzer = () => {
    try {
      const ctx = ensureAudioCtx();
      const now = ctx.currentTime;

      // Layer multiple oscillators for a harsh, loud buzzer tone
      const frequencies = [160, 320, 480, 800];
      frequencies.forEach(freq => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const dist = ctx.createWaveShaper();

        // Heavy distortion curve for that harsh buzzer character
        const curve = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
          const x = (i * 2) / 256 - 1;
          curve[i] = (Math.PI + 400) * x / (Math.PI + 400 * Math.abs(x));
        }
        dist.curve = curve;
        dist.oversample = "4x";

        osc.connect(dist);
        dist.connect(gain);
        gain.connect(ctx.destination);

        osc.type = "square";
        osc.frequency.setValueAtTime(freq, now);

        // Loud sustained blast — 1.2 seconds
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.6 / frequencies.length, now + 0.01);
        gain.gain.setValueAtTime(0.6 / frequencies.length, now + 1.1);
        gain.gain.linearRampToValueAtTime(0, now + 1.3);

        osc.start(now);
        osc.stop(now + 1.4);
      });
    } catch (e) { console.warn("Buzzer failed:", e); }
  };

  const ANNOUNCE_SECONDS = new Set([60, 50, 40, 30, 20, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);

  useEffect(() => {
    if (!timerRunning) return;
    timerRef.current = setInterval(() => {
      setTimerSeconds(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          setTimeout(() => {
            setTimerRunning(false);
            setTimerDone(true);
            buzzer();
            setTimeout(() => speak("That's game!"), 1200);
          }, 0);
          return 0;
        }
        const next = prev - 1;
        if (next % 60 === 0 && next > 0 && lastAnnouncedMinute.current !== next / 60) {
          lastAnnouncedMinute.current = next / 60;
          const mins = next / 60;
          speak(mins === 1 ? "One minute left!" : `${mins} minutes left.`);
        }
        if (ANNOUNCE_SECONDS.has(next)) {
          speak(next <= 10 ? `${next}` : `${next} seconds!`);
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [timerRunning]);

  const startTimer = () => {
    ensureAudioCtx(); // warm up audio context on user gesture
    lastAnnouncedMinute.current = null;
    setTimerDone(false);
    setTimerRunning(true);
    const mins = Math.floor(timerSeconds / 60);
    const secs = timerSeconds % 60;
    const timeText = secs === 0
      ? `${mins} minute${mins === 1 ? "" : "s"}`
      : `${mins} minute${mins === 1 ? "" : "s"} and ${secs} seconds`;
    speak(`${timeText} on the clock!`);
  };

  const pauseTimer = () => setTimerRunning(false);

  const resetTimer = () => {
    clearInterval(timerRef.current);
    setTimerRunning(false);
    setTimerDone(false);
    setTimerSeconds(TIMER_DURATION);
    lastAnnouncedMinute.current = null;
    window.speechSynthesis?.cancel();
  };

  const timerDisplay = () => {
    const m = Math.floor(timerSeconds / 60);
    const s = timerSeconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // ── ADMIN ──────────────────────────────────────────────────────────────────
  const resetAdminTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    setAdminCountdown(null);
    if (adminTimerRef.current) clearTimeout(adminTimerRef.current);
    // Lock after 30s total — start 10s countdown after 20s idle
    adminTimerRef.current = setTimeout(() => {
      setIsAdmin(false); setSwapMode(null); setSubModal(null); setPickedUp(null); setAdminCountdown(null);
    }, ADMIN_TIMEOUT);
  }, []);

  // Idle watcher — checks every second if user has been idle > 10s, then shows 30s countdown
  useEffect(() => {
    if (!isAdmin) { setAdminCountdown(null); return; }
    adminCountdownRef.current = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current;
      if (idle >= 10_000) {
        const remaining = Math.ceil((40_000 - idle) / 1000);
        if (remaining <= 0) {
          setAdminCountdown(null);
        } else {
          setAdminCountdown(Math.min(remaining, 30));
        }
      } else {
        setAdminCountdown(null);
      }
    }, 500);
    return () => clearInterval(adminCountdownRef.current);
  }, [isAdmin]);

  const withAdmin = (fn) => (...args) => {
    if (!isAdmin) return;
    resetAdminTimer();
    fn(...args);
  };

  const logout = () => {
    setIsAdmin(false); setSwapMode(null); setSubModal(null); setPickedUp(null); setAdminCountdown(null);
    if (adminTimerRef.current) clearTimeout(adminTimerRef.current);
    clearInterval(adminCountdownRef.current);
  };

  // Start the 30s lock timer when admin logs in
  useEffect(() => {
    if (isAdmin) resetAdminTimer();
    return () => { if (adminTimerRef.current) clearTimeout(adminTimerRef.current); };
  }, [isAdmin, resetAdminTimer]);

  // ── PLAYERS ────────────────────────────────────────────────────────────────
  // Capitalize each word: "john smith" -> "John Smith"
  const capitalizeName = (name) => name
    .trim()
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");

  const addPlayer = useCallback((rawName) => {
    if (!rawName.trim()) return;
    const name = capitalizeName(rawName);

    // Duplicate check — case-insensitive, against everyone currently in the session
    const pool = view === VIEWS.SETUP
      ? setupPlayers
      : [...teamA, ...teamB, ...queue, ...sittingOut, ...left];
    const isDupe = pool.some(p => p.name.toLowerCase() === name.toLowerCase());
    if (isDupe) {
      setDupeWarning(name);
      return;
    }

    const jc = joinCounter + 1;
    setJoinCounter(jc);
    const p = initPlayer(name, jc);
    if (view === VIEWS.SETUP) setSetupPlayers(prev => [...prev, p]);
    else setQueue(prev => sortQueue([...prev, p]));
    setNameInput("");
  }, [joinCounter, view, setupPlayers, teamA, teamB, queue, sittingOut, left]);

  const removeSetupPlayer = withAdmin((id) => setSetupPlayers(prev => prev.filter(p => p.id !== id)));

  // Used when the user confirms "add anyway" on the duplicate warning
  const forceAddPlayer = (name) => {
    const jc = joinCounter + 1;
    setJoinCounter(jc);
    const p = initPlayer(name, jc);
    if (view === VIEWS.SETUP) setSetupPlayers(prev => [...prev, p]);
    else setQueue(prev => sortQueue([...prev, p]));
    setNameInput("");
    setDupeWarning(null);
  };

  const startSession = () => {
    if (setupPlayers.length < 10) return;
    const sorted = sortQueue(setupPlayers);
    setTeamA(sorted.slice(0, TEAM_SIZE).map(p => ({ ...p, hasPlayed: true, roundsWaited: 0 })));
    setTeamB(sorted.slice(TEAM_SIZE, TEAM_SIZE * 2).map(p => ({ ...p, hasPlayed: true, roundsWaited: 0 })));
    setQueue(sortQueue(sorted.slice(TEAM_SIZE * 2)));
    setSittingOut([]); setLeft([]);
    setGameCount(1); setLastResult(null); setHistory([]);
    setView(VIEWS.GAME);
    if (isAdmin) logout();
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const endSession = () => {
    setTeamA([]); setTeamB([]); setQueue([]); setSittingOut([]); setLeft([]);
    setGameCount(1); setLastResult(null); setHistory([]);
    setSetupPlayers([]); setJoinCounter(0); setNameInput("");
    setSubModal(null); setSwapMode(null); setLastWinner(null); setConfirmModal(null); setMoveConfirm(null);
    setPickedUp(null);
    setTimerSeconds(TIMER_DURATION); setTimerRunning(false); setTimerDone(false);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* unavailable */ }
    setView(VIEWS.SETUP);
    setEndSessionConfirm(false);
    logout();
  };

  // ── QUEUE MANAGEMENT ──────────────────────────────────────────────────────
  const skipRound = withAdmin((playerId) => {
    const p = queue.find(x => x.id === playerId);
    if (!p) return;
    setQueue(prev => sortQueue(prev.filter(x => x.id !== playerId)));
    setSittingOut(prev => [...prev, p]);
  });

  const rejoin = withAdmin((playerId) => {
    const p = sittingOut.find(x => x.id === playerId);
    if (!p) return;
    setSittingOut(prev => prev.filter(x => x.id !== playerId));
    setQueue(prev => sortQueue([...prev, p]));
  });

  const leaveFromWaiting = withAdmin((playerId) => {
    const p = queue.find(x => x.id === playerId) || sittingOut.find(x => x.id === playerId);
    if (p) setLeft(prev => [...prev, { ...p, leftAtGame: gameCount }]);
    setQueue(prev => prev.filter(x => x.id !== playerId));
    setSittingOut(prev => prev.filter(x => x.id !== playerId));
  });

  const rejoinFromLeft = withAdmin((playerId) => {
    const p = left.find(x => x.id === playerId);
    if (!p) return;
    setLeft(prev => prev.filter(x => x.id !== playerId));
    const gamesMissed = gameCount - (p.leftAtGame || gameCount);
    setQueue(prev => sortQueue([...prev, { ...p, hasPlayed: true, roundsWaited: gamesMissed }]));
  });

  const removeFromLeft = withAdmin((playerId) => setLeft(prev => prev.filter(x => x.id !== playerId)));

  // ── SUBS ──────────────────────────────────────────────────────────────────
  const getIncoming = () => sortQueue([...queue, ...sittingOut])[0] || null;

  const regularSub = withAdmin((playerId, isTeamA) => {
    const team = isTeamA ? teamA : teamB;
    const subbed = team.find(x => x.id === playerId);
    if (!subbed) return;
    const incoming = getIncoming();
    if (!incoming) return;

    const incomingFromQueue = queue.some(x => x.id === incoming.id);

    setQueue(prev => {
      // Age everyone, remove the incoming player if they were here, then add subbed
      const afterRemoval = prev.filter(x => x.id !== incoming.id).map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 }));
      const fair = fairRoundsWaited(afterRemoval);
      return sortQueue([...afterRemoval, { ...subbed, hasPlayed: true, gamesPlayed: (subbed.gamesPlayed || 0) + 1, roundsWaited: fair }]);
    });
    if (!incomingFromQueue) {
      setSittingOut(prev => prev.filter(x => x.id !== incoming.id).map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })));
    } else {
      setSittingOut(prev => prev.map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })));
    }

    if (isTeamA) setTeamA(prev => [...prev.filter(x => x.id !== playerId), { ...incoming, hasPlayed: true, streakedOut: false }]);
    else setTeamB(prev => [...prev.filter(x => x.id !== playerId), { ...incoming, hasPlayed: true, streakedOut: false }]);
    setSubModal(null);
  });

  const injurySub = withAdmin((playerId, isTeamA) => {
    const team = isTeamA ? teamA : teamB;
    const injured = team.find(x => x.id === playerId);
    if (!injured) return;
    const incoming = getIncoming();
    if (!incoming) return;

    const incomingFromQueue = queue.some(x => x.id === incoming.id);

    if (incomingFromQueue) {
      setQueue(prev => prev.filter(x => x.id !== incoming.id).map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })));
      setSittingOut(prev => [...prev.map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })), { ...injured, hasPlayed: true, gamesPlayed: (injured.gamesPlayed || 0) + 1 }]);
    } else {
      setQueue(prev => prev.map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })));
      setSittingOut(prev => [...prev.filter(x => x.id !== incoming.id).map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })), { ...injured, hasPlayed: true, gamesPlayed: (injured.gamesPlayed || 0) + 1 }]);
    }

    if (isTeamA) setTeamA(prev => [...prev.filter(x => x.id !== playerId), { ...incoming, hasPlayed: true, streakedOut: false }]);
    else setTeamB(prev => [...prev.filter(x => x.id !== playerId), { ...incoming, hasPlayed: true, streakedOut: false }]);
    setSubModal(null);
  });

  // Player on court is done for the day — pull next from pool, mark leaving player as Left
  const leaveFromCourt = withAdmin((playerId, isTeamA) => {
    const team = isTeamA ? teamA : teamB;
    const leaving = team.find(x => x.id === playerId);
    if (!leaving) return;
    const incoming = getIncoming();
    if (!incoming) {
      window.alert(`${leaving.name} can't leave — no one is waiting to sub in. Add players to the queue first, or remove a team if you want to play short-handed.`);
      return;
    }

    const incomingFromQueue = queue.some(x => x.id === incoming.id);
    if (incomingFromQueue) {
      setQueue(prev => prev.filter(x => x.id !== incoming.id).map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })));
      setSittingOut(prev => prev.map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })));
    } else {
      setQueue(prev => prev.map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })));
      setSittingOut(prev => prev.filter(x => x.id !== incoming.id).map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })));
    }

    setLeft(prev => [...prev, { ...leaving, hasPlayed: true, gamesPlayed: (leaving.gamesPlayed || 0) + 1, leftAtGame: gameCount }]);
    if (isTeamA) setTeamA(prev => [...prev.filter(x => x.id !== playerId), { ...incoming, hasPlayed: true, streakedOut: false }]);
    else setTeamB(prev => [...prev.filter(x => x.id !== playerId), { ...incoming, hasPlayed: true, streakedOut: false }]);
  });

  const subInSpecific = (incomingPlayer, replacedId, isTeamA, injury) => {
    const team = isTeamA ? teamA : teamB;
    const replaced = team.find(x => x.id === replacedId);
    if (!replaced) return;

    const incomingFromQueue = queue.some(x => x.id === incomingPlayer.id);

    if (injury) {
      if (incomingFromQueue) {
        setQueue(prev => prev.filter(x => x.id !== incomingPlayer.id).map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })));
        setSittingOut(prev => [...prev.map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })), { ...replaced, hasPlayed: true, gamesPlayed: (replaced.gamesPlayed || 0) + 1 }]);
      } else {
        setQueue(prev => prev.map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })));
        setSittingOut(prev => [...prev.filter(x => x.id !== incomingPlayer.id).map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })), { ...replaced, hasPlayed: true, gamesPlayed: (replaced.gamesPlayed || 0) + 1 }]);
      }
    } else {
      if (incomingFromQueue) {
        setQueue(prev => {
          const afterRemoval = prev.filter(x => x.id !== incomingPlayer.id).map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 }));
          const fair = fairRoundsWaited(afterRemoval);
          return sortQueue([...afterRemoval, { ...replaced, hasPlayed: true, gamesPlayed: (replaced.gamesPlayed || 0) + 1, roundsWaited: fair }]);
        });
        setSittingOut(prev => prev.map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })));
      } else {
        setSittingOut(prev => prev.filter(x => x.id !== incomingPlayer.id).map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })));
        setQueue(prev => {
          const afterAging = prev.map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 }));
          const fair = fairRoundsWaited(afterAging);
          return sortQueue([...afterAging, { ...replaced, hasPlayed: true, gamesPlayed: (replaced.gamesPlayed || 0) + 1, roundsWaited: fair }]);
        });
      }
    }

    if (isTeamA) setTeamA(prev => [...prev.filter(x => x.id !== replacedId), { ...incomingPlayer, hasPlayed: true, streakedOut: false }]);
    else setTeamB(prev => [...prev.filter(x => x.id !== replacedId), { ...incomingPlayer, hasPlayed: true, streakedOut: false }]);
  };

  const doSwap = (aId, bId) => {
    const fromA = teamA.find(x => x.id === aId);
    const fromB = teamB.find(x => x.id === bId);
    if (!fromA || !fromB) return;
    setTeamA(prev => prev.map(p => p.id === aId ? { ...fromB, roundsWaited: 0 } : p));
    setTeamB(prev => prev.map(p => p.id === bId ? { ...fromA, roundsWaited: 0 } : p));
  };

  // ── PICK UP / PLACE ───────────────────────────────────────────────────────
  const pickUp = (player, fromZone) => {
    if (!isAdmin) return;
    resetAdminTimer();
    if (pickedUp?.player.id === player.id) { setPickedUp(null); return; }
    setPickedUp({ player, fromZone });
  };

  const cancelPickup = () => setPickedUp(null);

  const placeOnto = (toZone, targetPlayer, cancel = false) => {
    if (!isAdmin) return;
    resetAdminTimer();
    if (cancel) { setPickedUp(null); return; }
    if (!pickedUp) return;
    const { player, fromZone } = pickedUp;
    if (targetPlayer?.id === player.id) { setPickedUp(null); return; }
    const confirm = buildMoveConfirm(player, fromZone, toZone, targetPlayer);
    if (confirm) setMoveConfirm(confirm);
    setPickedUp(null);
  };

  const buildMoveConfirm = (player, fromZone, toZone, targetPlayer) => {
    const fromLabel = ZONE_LABELS[fromZone];
    const toLabel = ZONE_LABELS[toZone];

    // Move above someone in queue
    if (fromZone === ZONES.QUEUE && toZone === ZONES.QUEUE && targetPlayer && targetPlayer.id !== player.id) {
      const sorted = sortQueue(queue);
      const fromIdx = sorted.findIndex(p => p.id === player.id);
      const toIdx = sorted.findIndex(p => p.id === targetPlayer.id);
      if (fromIdx <= toIdx) return { title: "Already ahead", desc: `${player.name} is already above ${targetPlayer.name}.`, actions: [] };
      return {
        title: `Move ${player.name} above ${targetPlayer.name}?`,
        desc: `${player.name} jumps to #${toIdx + 1} in the queue.`,
        actions: [{ label: "Move up", style: "primary", fn: () => {
          setQueue(prev => sortQueue(prev.map(p => {
            if (p.id === player.id) return { ...p, roundsWaited: targetPlayer.roundsWaited + 1 };
            if (p.id === targetPlayer.id) return { ...p, roundsWaited: player.roundsWaited };
            return p;
          })));
        }}],
      };
    }

    // Sub waiting player onto a team
    if ((toZone === ZONES.TEAM_A || toZone === ZONES.TEAM_B) &&
        (fromZone === ZONES.QUEUE || fromZone === ZONES.SITTING || fromZone === ZONES.LEFT) && targetPlayer) {
      const isTeamA = toZone === ZONES.TEAM_A;
      return {
        title: `Sub ${player.name} in for ${targetPlayer.name}?`,
        desc: `${player.name} joins ${toLabel}`,
        actions: [
          { label: `Regular — ${targetPlayer.name} goes to queue`, style: "primary", fn: () => subInSpecific(player, targetPlayer.id, isTeamA, false) },
          { label: `🤕 Injury — ${targetPlayer.name} sits out`, style: "warning", fn: () => subInSpecific(player, targetPlayer.id, isTeamA, true) },
        ],
      };
    }

    // Swap between teams
    if ((fromZone === ZONES.TEAM_A && toZone === ZONES.TEAM_B) ||
        (fromZone === ZONES.TEAM_B && toZone === ZONES.TEAM_A)) {
      if (targetPlayer) {
        return {
          title: `Swap ${player.name} ↔ ${targetPlayer.name}?`,
          desc: `${player.name} → ${toLabel} · ${targetPlayer.name} → ${fromLabel}`,
          actions: [{ label: "Swap", style: "primary", fn: () => {
            if (fromZone === ZONES.TEAM_A) doSwap(player.id, targetPlayer.id);
            else doSwap(targetPlayer.id, player.id);
          }}],
        };
      }
    }

    // Remove from court
    if ((fromZone === ZONES.TEAM_A || fromZone === ZONES.TEAM_B) &&
        toZone !== ZONES.TEAM_A && toZone !== ZONES.TEAM_B) {
      const isTeamA = fromZone === ZONES.TEAM_A;
      const incoming = getIncoming();
      if (!incoming) return { title: "No one to sub in", desc: "Add players to the queue first.", actions: [] };
      const destDesc = toZone === ZONES.SITTING ? "sits out" : toZone === ZONES.LEFT ? "is marked as left" : "goes to queue";
      return {
        title: `Remove ${player.name} from ${fromLabel}?`,
        desc: `${incoming.name} subs in · ${player.name} ${destDesc}`,
        actions: [{ label: "Confirm", style: "primary", fn: () => {
          const incomingFromQueue = queue.some(x => x.id === incoming.id);
          if (toZone === ZONES.SITTING) {
            if (incomingFromQueue) {
              setQueue(prev => prev.filter(x => x.id !== incoming.id).map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })));
              setSittingOut(prev => [...prev.map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })), { ...player, hasPlayed: true, gamesPlayed: (player.gamesPlayed || 0) + 1 }]);
            } else {
              setQueue(prev => prev.map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })));
              setSittingOut(prev => [...prev.filter(x => x.id !== incoming.id).map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })), { ...player, hasPlayed: true, gamesPlayed: (player.gamesPlayed || 0) + 1 }]);
            }
          } else if (toZone === ZONES.LEFT) {
            if (incomingFromQueue) {
              setQueue(prev => prev.filter(x => x.id !== incoming.id).map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })));
              setSittingOut(prev => prev.map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })));
            } else {
              setQueue(prev => prev.map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })));
              setSittingOut(prev => prev.filter(x => x.id !== incoming.id).map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })));
            }
            setLeft(prev => [...prev, { ...player, hasPlayed: true, gamesPlayed: (player.gamesPlayed || 0) + 1, leftAtGame: gameCount }]);
          } else {
            // toZone === QUEUE
            if (incomingFromQueue) {
              setQueue(prev => {
                const afterRemoval = prev.filter(x => x.id !== incoming.id).map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 }));
                const fair = fairRoundsWaited(afterRemoval);
                return sortQueue([...afterRemoval, { ...player, hasPlayed: true, gamesPlayed: (player.gamesPlayed || 0) + 1, roundsWaited: fair }]);
              });
              setSittingOut(prev => prev.map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })));
            } else {
              setSittingOut(prev => prev.filter(x => x.id !== incoming.id).map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 })));
              setQueue(prev => {
                const afterAging = prev.map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 }));
                const fair = fairRoundsWaited(afterAging);
                return sortQueue([...afterAging, { ...player, hasPlayed: true, gamesPlayed: (player.gamesPlayed || 0) + 1, roundsWaited: fair }]);
              });
            }
          }
          if (isTeamA) setTeamA(prev => [...prev.filter(x => x.id !== player.id), { ...incoming, hasPlayed: true, streakedOut: false }]);
          else setTeamB(prev => [...prev.filter(x => x.id !== player.id), { ...incoming, hasPlayed: true, streakedOut: false }]);
        }}],
      };
    }

    // Cross-section moves
    const moves = {
      [`${ZONES.QUEUE}-${ZONES.SITTING}`]: { title: `Move ${player.name} to Sitting Out?`, desc: "Skips next rotation, keeps queue priority.", fn: () => skipRound(player.id) },
      [`${ZONES.SITTING}-${ZONES.QUEUE}`]: { title: `Move ${player.name} back to Queue?`, desc: "Rejoins at current priority.", fn: () => rejoin(player.id) },
      [`${ZONES.QUEUE}-${ZONES.LEFT}`]: { title: `Mark ${player.name} as Left?`, desc: "Can return with priority based on time away.", fn: () => leaveFromWaiting(player.id) },
      [`${ZONES.SITTING}-${ZONES.LEFT}`]: { title: `Mark ${player.name} as Left?`, desc: "Can return with priority based on time away.", fn: () => leaveFromWaiting(player.id) },
      [`${ZONES.LEFT}-${ZONES.QUEUE}`]: { title: `Bring ${player.name} back?`, desc: `Out for ${gameCount - (player.leftAtGame || gameCount)} games — priority adjusted.`, fn: () => rejoinFromLeft(player.id) },
    };
    const m = moves[`${fromZone}-${toZone}`];
    if (m) return { title: m.title, desc: m.desc, actions: [{ label: "Confirm", style: "primary", fn: m.fn }] };
    return null;
  };

  // ── RESULT ────────────────────────────────────────────────────────────────
  const saveSnapshot = () => setHistory(prev => [...prev, { teamA, teamB, queue, sittingOut, left, gameCount, lastResult }]);

  const undo = withAdmin(() => {
    if (!history.length) return;
    const prev = history[history.length - 1];
    setTeamA(prev.teamA); setTeamB(prev.teamB); setQueue(prev.queue);
    setSittingOut(prev.sittingOut); setLeft(prev.left);
    setGameCount(prev.gameCount); setLastResult(prev.lastResult);
    setHistory(h => h.slice(0, -1));
  });

  const recordResult = (winnerIsA) => {
    const winner = winnerIsA ? teamA : teamB;
    const loser = winnerIsA ? teamB : teamA;

    // Increment winStreak for everyone currently on the winning team
    const winnerWithStreak = winner.map(p => ({ ...p, winStreak: (p.winStreak || 0) + 1, gamesPlayed: (p.gamesPlayed || 0) + 1 }));
    const loserWithStreak = loser.map(p => ({ ...p, winStreak: 0, gamesPlayed: (p.gamesPlayed || 0) + 1 }));

    // Anyone on the winning team who's hit 2 wins in a row wants to be pulled
    const wantsOut = winnerWithStreak.filter(p => p.winStreak >= 2);
    const notStreaking = winnerWithStreak.filter(p => p.winStreak < 2);

    // Cap how many can actually be replaced based on the queue/sitting pool —
    // the loser's 5 always cover the challenger team, so only queue+sitting
    // is available for extra streak-out replacements.
    const replaceable = Math.min(wantsOut.length, queue.length + sittingOut.length);
    // Prioritize pulling whoever has played the MOST games — they've had their
    // run already. Whoever has played the fewest games is forced to stay if
    // there aren't enough subs to go around.
    const wantsOutRanked = [...wantsOut].sort((a, b) => (b.gamesPlayed || 0) - (a.gamesPlayed || 0));
    const streakOut = wantsOutRanked.slice(0, replaceable);
    const forcedStay = wantsOutRanked.slice(replaceable); // couldn't be replaced, stay on court, streak resets
    const staying = [...notStreaking, ...forcedStay.map(p => ({ ...p, winStreak: 0 }))];

    const emptySpots = streakOut.length;

    if (isAdmin) resetAdminTimer();
    saveSnapshot();

    const agedQueue = queue.map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 }));
    const agedSitting = sittingOut.map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 }));
    const loserAged = loserWithStreak.map(p => ({ ...p, roundsWaited: p.roundsWaited + 1 }));

    // Streak-holders who do get pulled reset fully and go to the back of the line.
    // Tagged with streakedOut so the queue can show why they're sitting even
    // though their gamesPlayed looks normal — cleared the next time they play.
    const streakOutAged = streakOut.map(p => ({ ...p, winStreak: 0, roundsWaited: 0, hasPlayed: true, streakedOut: true }));

    const pool = sortQueue([...agedQueue, ...agedSitting, ...loserAged]);
    const { nextTeam: challenger, bench: nq } = pickNextTeam(pool);

    // Fill any streak-out spots from the remaining bench, then drop streak-outs to the back
    let fillers = [];
    let remainingBench = nq;
    if (emptySpots > 0) {
      const { nextTeam: fill, bench: afterFill } = pickNextTeam(nq);
      fillers = fill.slice(0, emptySpots).map(p => ({ ...p, roundsWaited: 0, streakedOut: false }));
      remainingBench = [...afterFill, ...fill.slice(emptySpots)];
    }

    const winningTeamNext = [...staying, ...fillers];
    const finalQueue = sortQueue([...remainingBench, ...streakOutAged]);

    if (winnerIsA) {
      setTeamA(winningTeamNext);
      setTeamB(challenger.map(p => ({ ...p, roundsWaited: 0, streakedOut: false })));
    } else {
      setTeamB(winningTeamNext);
      setTeamA(challenger.map(p => ({ ...p, roundsWaited: 0, streakedOut: false })));
    }
    setQueue(finalQueue);
    setSittingOut([]);
    setAnimKey(k => k + 1);
    setLastWinner(winnerIsA ? "A" : "B");

    const forcedStayCount = wantsOut.length - replaceable;
    if (emptySpots > 0 && emptySpots === TEAM_SIZE) {
      setLastResult({ winner: "Full streak — entire team rotates off", loser: "" });
    } else if (emptySpots > 0 && forcedStayCount > 0) {
      setLastResult({ winner: `${winnerIsA ? "Home" : "Away"} stays on · ${emptySpots} streak player${emptySpots > 1 ? "s" : ""} rotate out`, loser: `⚠️ ${forcedStayCount} more streak player${forcedStayCount > 1 ? "s" : ""} forced to stay — not enough in queue` });
    } else if (emptySpots > 0) {
      setLastResult({ winner: `${winnerIsA ? "Home" : "Away"} stays on · ${emptySpots} streak player${emptySpots > 1 ? "s" : ""} rotate out`, loser: `${winnerIsA ? "Away" : "Home"} sits` });
    } else {
      setLastResult({ winner: `${winnerIsA ? "Home" : "Away"} stays on`, loser: `${winnerIsA ? "Away" : "Home"} sits` });
    }
    setGameCount(g => g + 1);
  };

  const loadTestData = withAdmin(() => {
    const names = ["Marcus","DeShawn","Jamal","Tyler","Kobe","Andre","Chris","Jordan","Mike","Damian","Zach","Kevin"];
    let jc = joinCounter;
    setSetupPlayers(names.map(name => { jc++; return initPlayer(name, jc); }));
    setJoinCounter(jc);
  });

  const loadTestData24 = withAdmin(() => {
    const names = ["Marcus","DeShawn","Jamal","Tyler","Kobe","Andre","Chris","Jordan","Mike","Damian","Zach","Kevin","Isaiah","Darius","Trey","Brandon","Malik","Devon","Quincy","Jalen","Aaron","Elijah","Cody","Rashad"];
    let jc = joinCounter;
    setSetupPlayers(names.map(name => { jc++; return initPlayer(name, jc); }));
    setJoinCounter(jc);
  });

  // ── MODALS ────────────────────────────────────────────────────────────────
  const PinModal = () => (
    <div style={s.overlay} onClick={() => { setPinModal(false); setPinInput(""); setPinError(false); }}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <p style={s.modalTitle}>Admin PIN</p>
        <div style={s.pinDots}>
          {[0,1,2,3].map(i => <div key={i} style={{ ...s.pinDot, ...(pinInput.length > i ? s.pinDotFilled : {}) }} />)}
        </div>
        {pinError && <p style={s.pinError}>Incorrect PIN</p>}
        <div style={s.pinGrid}>
          {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((k, i) => (
            <button key={i} style={{ ...s.pinKey, ...(k === "" ? s.pinKeyEmpty : {}) }}
              onClick={() => {
                if (k === "") return;
                if (k === "⌫") { setPinInput(p => p.slice(0, -1)); setPinError(false); return; }
                if (pinInput.length < 4) {
                  const next = pinInput + k; setPinInput(next); setPinError(false);
                  if (next.length === 4) setTimeout(() => {
                    if (next === ADMIN_PIN) { setIsAdmin(true); setPinModal(false); setPinInput(""); }
                    else { setPinError(true); setPinInput(""); }
                  }, 100);
                }
              }}>{k}</button>
          ))}
        </div>
        <button style={s.btnCancel} onClick={() => { setPinModal(false); setPinInput(""); setPinError(false); }}>Cancel</button>
      </div>
    </div>
  );

  const MoveConfirmModal = () => {
    if (!moveConfirm) return null;
    return (
      <div style={s.overlay} onClick={() => setMoveConfirm(null)}>
        <div style={s.modal} onClick={e => e.stopPropagation()}>
          <p style={s.modalTitle}>{moveConfirm.title}</p>
          {moveConfirm.desc && <p style={s.modalDesc}>{moveConfirm.desc}</p>}
          {moveConfirm.actions.map((a, i) => (
            <button key={i} style={a.style === "warning" ? s.btnWarning : s.btnPrimary}
              onClick={() => { a.fn(); setMoveConfirm(null); }}>{a.label}</button>
          ))}
          <button style={s.btnCancel} onClick={() => setMoveConfirm(null)}>
            {moveConfirm.actions.length === 0 ? "OK" : "Cancel"}
          </button>
        </div>
      </div>
    );
  };

  // ── SETUP VIEW ────────────────────────────────────────────────────────────
  if (view === VIEWS.SETUP) {
    return (
      <div style={s.root}>
        {pinModal && <PinModal />}
        {endSessionConfirm && (
          <div style={s.overlay} onClick={() => setEndSessionConfirm(false)}>
            <div style={s.modal} onClick={e => e.stopPropagation()}>
              <p style={s.modalTitle}>Clear saved session?</p>
              <p style={s.modalDesc}>This clears all players, teams, and history. Cannot be undone.</p>
              <button style={s.btnWarning} onClick={endSession}>🗑 Yes, clear it</button>
              <button style={s.btnCancel} onClick={() => setEndSessionConfirm(false)}>Cancel</button>
            </div>
          </div>
        )}
        {dupeWarning && (
          <div style={s.overlay} onClick={() => setDupeWarning(null)}>
            <div style={s.modal} onClick={e => e.stopPropagation()}>
              <p style={s.modalTitle}>Already signed up</p>
              <p style={s.modalDesc}>"{dupeWarning}" is already on the list. Is this a different person with the same name?</p>
              <button style={s.btnPrimary} onClick={() => forceAddPlayer(dupeWarning)}>Add anyway</button>
              <button style={s.btnCancel} onClick={() => setDupeWarning(null)}>Cancel</button>
            </div>
          </div>
        )}
        <div style={s.header}>
          <div style={s.ball}>🏀</div>
          <h1 style={s.title}>NEXT GAME</h1>
          <p style={s.sub}>Pickup run manager</p>
        </div>
        {isAdmin ? (
          <>
            <button style={s.testBtn} onClick={loadTestData}>Load 12 test players</button>
            <button style={s.testBtn} onClick={loadTestData24}>Load 24 test players</button>
            <button style={s.logoutBtn} onClick={() => setEndSessionConfirm(true)}>🗑 Clear saved session</button>
            <button style={s.logoutBtn} onClick={logout}>Lock admin</button>
          </>
        ) : (
          <button style={s.adminUnlockBtn} onClick={() => setPinModal(true)}>🔒 Admin</button>
        )}

        {(() => {
          const addedNames = new Set(setupPlayers.map(p => p.name.toLowerCase()));
          const sortKey = (n) => n.replace(/^(Pastor|Dr|Mr|Mrs|Ms)\s+/i, "");
          const available = KNOWN_PLAYERS.filter(n => !addedNames.has(n.toLowerCase())).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
          if (available.length === 0) return null;
          return (
            <div style={s.card}>
              <p style={s.sectionLabel}>Tap your name to sign up</p>
              <div style={s.chipGrid}>
                {available.map(name => (
                  <button key={name} style={s.chip} onClick={() => addPlayer(name)}>{name}</button>
                ))}
              </div>
            </div>
          );
        })()}

        <div style={s.card}>
          <p style={s.sectionLabel}>Not on the list?</p>
          <div style={s.row}>
            <input style={s.input} placeholder="Your name" value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addPlayer(nameInput)} />
            <button style={s.addBtn} onClick={() => addPlayer(nameInput)}>+</button>
          </div>
        </div>

        <div style={s.card}>
          <div style={s.countRow}>
            <span style={s.countNum}>{setupPlayers.length}</span>
            <span style={s.countLabel}> signed up</span>
            {setupPlayers.length >= 10 && (
              <span style={s.teamsTag}>{Math.floor(setupPlayers.length / TEAM_SIZE)} teams{setupPlayers.length % TEAM_SIZE > 0 ? ` +${setupPlayers.length % TEAM_SIZE}` : ""}</span>
            )}
          </div>
          {setupPlayers.map((p, i) => (
            <div key={p.id} style={s.playerRow}>
              <span style={s.playerNum}>{i + 1}</span>
              <span style={s.playerName}>{p.name}</span>
              {isAdmin && <button style={s.removeBtn} onClick={() => removeSetupPlayer(p.id)}>×</button>}
            </div>
          ))}
          {setupPlayers.length === 0 && <p style={s.warn}>No one signed up yet</p>}
        </div>

        <button
          style={{ ...s.primaryBtn, ...(setupPlayers.length < 10 ? s.primaryBtnDisabled : {}) }}
          disabled={setupPlayers.length < 10}
          onClick={startSession}>
          {setupPlayers.length >= 10 ? "Run It 🏀" : `Need ${10 - setupPlayers.length} more to start`}
        </button>
      </div>
    );
  }

  // ── GAME VIEW ─────────────────────────────────────────────────────────────
  const total = teamA.length + teamB.length + queue.length + sittingOut.length + left.length;
  const canSub = isAdmin && (queue.length > 0 || sittingOut.length > 0);
  const poolBelowMin = false; // disabled — recordResult guard handles this accurately now
  const sortedQueue = sortQueue(queue);
  const isPU = (p) => pickedUp?.player.id === p.id;

  return (
    <div style={s.root}>
      {pinModal && <PinModal />}
      <MoveConfirmModal />

      {/* Sub modal */}
      {subModal && isAdmin && (
        <div style={s.overlay} onClick={() => setSubModal(null)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <p style={s.modalTitle}>Sub out {[...teamA, ...teamB].find(p => p.id === subModal.playerId)?.name}</p>
            <button style={s.btnPrimary} onClick={() => regularSub(subModal.playerId, subModal.isTeamA)}>
              Regular sub <span style={s.hint}>Goes to back of queue</span>
            </button>
            <button style={s.btnWarning} onClick={() => injurySub(subModal.playerId, subModal.isTeamA)}>
              🤕 Injury <span style={s.hint}>Sits out · sub keeps queue spot</span>
            </button>
            <button style={s.btnCancel} onClick={() => setSubModal(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Confirm result modal */}
      {confirmModal && (
        <div style={s.overlay} onClick={() => setConfirmModal(null)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <p style={s.modalTitle}>Confirm result</p>
            <p style={s.modalDesc}>Did <span style={{ color: confirmModal.winnerIsA ? "#FF9500" : "#007AFF", fontWeight: 800 }}>{confirmModal.winnerIsA ? "Home" : "Away"}</span> just win?</p>
            <button style={{ ...s.btnPrimary, background: confirmModal.winnerIsA ? "#FFF4E6" : "#EBF4FF" }}
              onClick={() => { recordResult(confirmModal.winnerIsA); setConfirmModal(null); }}>
              <span style={{ color: confirmModal.winnerIsA ? "#FF9500" : "#007AFF", fontWeight: 800, fontSize: 16 }}>✓ Yes, {confirmModal.winnerIsA ? "Home" : "Away"} wins</span>
            </button>
            <button style={s.btnCancel} onClick={() => setConfirmModal(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* End session confirmation modal */}
      {endSessionConfirm && (
        <div style={s.overlay} onClick={() => setEndSessionConfirm(false)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <p style={s.modalTitle}>End this session?</p>
            <p style={s.modalDesc}>This clears all players, teams, and history. Cannot be undone.</p>
            <button style={s.btnWarning} onClick={endSession}>🗑 Yes, end session</button>
            <button style={s.btnCancel} onClick={() => setEndSessionConfirm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Duplicate name warning */}
      {dupeWarning && (
        <div style={s.overlay} onClick={() => setDupeWarning(null)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <p style={s.modalTitle}>Already signed up</p>
            <p style={s.modalDesc}>"{dupeWarning}" is already on the list. Is this a different person with the same name?</p>
            <button style={s.btnPrimary} onClick={() => forceAddPlayer(dupeWarning)}>Add anyway</button>
            <button style={s.btnCancel} onClick={() => setDupeWarning(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Picked-up banner */}
      {pickedUp && (
        <div style={s.pickedBanner}>
          <span>📌 <strong>{pickedUp.player.name}</strong> — tap a player or section to place</span>
          <button style={s.pickedCancel} onClick={cancelPickup}>✕</button>
        </div>
      )}

      {/* Top bar */}
      <div style={s.topBar}>
        <span style={s.gameLabel}>GAME {gameCount}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={s.totalLabel}>{total} players</span>
          {isAdmin
            ? <button style={s.lockBtn} onClick={logout}>🔓 Lock</button>
            : <button style={s.lockBtn} onClick={() => setPinModal(true)}>🔒</button>}
        </div>
      </div>

      {isAdmin && !pickedUp && (
        <div style={{ ...s.adminBanner, ...(adminCountdown !== null ? s.adminBannerWarning : {}) }}
          onPointerDown={() => resetAdminTimer()}>
          {adminCountdown !== null
            ? `⚠️ Locking in ${adminCountdown}s — tap to stay`
            : "🔓 Admin — hold any player 0.6s to pick up · tap destination to place"}
        </div>
      )}

      {isAdmin && (
        <button style={s.newSessionBtn} onClick={() => setEndSessionConfirm(true)}>🗑 End session & start fresh</button>
      )}

      {lastResult && (
        <div style={s.resultBanner}>
          {lastResult.winner && <span style={s.bannerWin}>{lastResult.winner}</span>}
          {lastResult.loser && <><span style={s.bannerSep}> · </span><span style={s.bannerLose}>{lastResult.loser}</span></>}
        </div>
      )}
      {poolBelowMin && isAdmin && (
        <div style={s.warnBanner}>
          ⚠️ Only {queue.length + sittingOut.length} waiting — need {TEAM_SIZE} for the next team to sub in. Recording a result will be blocked until enough players are added.
        </div>
      )}

      <style>{`
        @keyframes winPulse{0%{box-shadow:0 0 0 0 rgba(52,199,89,0.5)}50%{box-shadow:0 0 0 12px rgba(52,199,89,0)}100%{box-shadow:0 0 0 0 rgba(74,222,128,0)}}
        @keyframes slideInRight{from{opacity:0;transform:translateX(32px)}to{opacity:1;transform:translateX(0)}}
        @keyframes slideInLeft{from{opacity:0;transform:translateX(-32px)}to{opacity:1;transform:translateX(0)}}
        .win-pulse{animation:winPulse 0.7s ease-out}
        .slide-in-right{animation:slideInRight 0.35s ease-out}
        .slide-in-left{animation:slideInLeft 0.35s ease-out}
      `}</style>

      {/* Court */}
      <div style={s.court}>
        <div style={s.halfLine} />

        {/* Team A — Home whites */}
        <div key={animKey+"A"}
          className={lastWinner==="A"?"win-pulse":lastWinner==="B"?"slide-in-left":lastWinner==="both"?"slide-in-right":""}
          style={{ ...tp.panel, borderTop: "3px solid #FF9500", background: "#FFFBF5", ...(pickedUp && pickedUp.fromZone !== ZONES.TEAM_A ? tp.zoneTarget : {}) }}
          onClick={() => { if (pickedUp && pickedUp.fromZone !== ZONES.TEAM_A) placeOnto(ZONES.TEAM_A, null); }}>
          <div style={tp.header}>
            <span style={{ ...tp.label, color: "#FF9500" }}>HOME</span>
            {pickedUp && pickedUp.fromZone !== ZONES.TEAM_A && <span style={tp.hint}>tap to place</span>}
          </div>
          {teamA.map(p => {
            const held = isPU(p);
            const target = pickedUp && !held;
            return (
              <CourtPlayerRow key={p.id} player={p} zone={ZONES.TEAM_A} held={held} target={target}
                isAdmin={isAdmin} canSub={canSub} pickedUp={pickedUp}
                pickUp={pickUp} placeOnto={placeOnto}
                onSub={() => setSubModal({ playerId: p.id, isTeamA: true })}
                onLeave={() => {
                  const incoming = getIncoming();
                  if (!incoming) { window.alert(`${p.name} can't leave — no one is waiting in the queue to sub in.`); return; }
                  setMoveConfirm({
                    title: `${p.name} is done for the day?`,
                    desc: `${incoming.name} subs in. ${p.name} moves to Left and can rejoin later if they come back.`,
                    actions: [{ label: "Confirm", style: "warning", fn: () => leaveFromCourt(p.id, true) }],
                  });
                }}
                color="rgba(255,149,0,0.1)"
              />
            );
          })}
        </div>

        <div style={s.vsCircle}><span style={s.vsText}>VS</span></div>

        {/* Team B — Away darks */}
        <div key={animKey+"B"}
          className={lastWinner==="B"?"win-pulse":lastWinner==="A"?"slide-in-right":lastWinner==="both"?"slide-in-left":""}
          style={{ ...tp.panel, borderTop: "3px solid #007AFF", background: "#F5F9FF", ...(pickedUp && pickedUp.fromZone !== ZONES.TEAM_B ? tp.zoneTarget : {}) }}
          onClick={() => { if (pickedUp && pickedUp.fromZone !== ZONES.TEAM_B) placeOnto(ZONES.TEAM_B, null); }}>
          <div style={tp.header}>
            <span style={{ ...tp.label, color: "#007AFF" }}>AWAY</span>
            {pickedUp && pickedUp.fromZone !== ZONES.TEAM_B && <span style={tp.hint}>tap to place</span>}
          </div>
          {teamB.map(p => {
            const held = isPU(p);
            const target = pickedUp && !held;
            return (
              <CourtPlayerRow key={p.id} player={p} zone={ZONES.TEAM_B} held={held} target={target}
                isAdmin={isAdmin} canSub={canSub} pickedUp={pickedUp}
                pickUp={pickUp} placeOnto={placeOnto}
                onSub={() => setSubModal({ playerId: p.id, isTeamA: false })}
                onLeave={() => {
                  const incoming = getIncoming();
                  if (!incoming) { window.alert(`${p.name} can't leave — no one is waiting in the queue to sub in.`); return; }
                  setMoveConfirm({
                    title: `${p.name} is done for the day?`,
                    desc: `${incoming.name} subs in. ${p.name} moves to Left and can rejoin later if they come back.`,
                    actions: [{ label: "Confirm", style: "warning", fn: () => leaveFromCourt(p.id, false) }],
                  });
                }}
                color="rgba(0,122,255,0.08)"
              />
            );
          })}
        </div>
      </div>

      {/* Win buttons */}
      <div style={s.btnRow}>
        <button style={{ ...s.winBtn, background: "#FF9500" }} onClick={() => isAdmin ? recordResult(true) : setConfirmModal({ winnerIsA: true })}>🏆 Home Wins</button>
        <button style={{ ...s.winBtn, background: "#007AFF" }} onClick={() => isAdmin ? recordResult(false) : setConfirmModal({ winnerIsA: false })}>🏆 Away Wins</button>
      </div>
      {isAdmin && history.length > 0 && <button style={s.undoBtn} onClick={undo}>↩ Undo last result</button>}

      {/* Game Timer */}
      <div style={{ ...s.card, ...(timerDone ? s.cardDone : timerRunning ? s.cardRunning : {}) }}>
        <p style={s.sectionLabel}>Game Timer</p>
        <div style={s.timerDisplay}>
          <span style={{ ...s.timerTime, color: timerDone ? "#FF3B30" : timerSeconds <= 60 ? "#FF9500" : "#007AFF" }}>
            {timerDisplay()}
          </span>
          {timerDone && <span style={s.timerDoneLabel}>GAME OVER</span>}
        </div>
        <div style={s.timerBtnRow}>
          <button style={s.timerBtnSub} onClick={() => setTimerSeconds(prev => Math.max(1, prev - 60))}>−1m</button>
          <button style={s.timerBtnSub} onClick={() => setTimerSeconds(prev => Math.max(1, prev - 10))}>−10s</button>
          {timerRunning
            ? <button style={s.timerBtnPause} onClick={pauseTimer}>⏸</button>
            : <button style={s.timerBtnStart} onClick={startTimer}>{timerDone ? "OT" : "▶"}</button>
          }
          <button style={s.timerBtnReset} onClick={resetTimer}>■</button>
          <button style={s.timerBtnAdd} onClick={() => setTimerSeconds(prev => prev + 10)}>+10s</button>
          <button style={s.timerBtnAdd} onClick={() => setTimerSeconds(prev => prev + 60)}>+1m</button>
        </div>
        <p style={s.timerHint}>Announces at every minute · "That's game!" at 0:00</p>
      </div>

      {/* Queue */}
      {sortedQueue.length > 0 && (
        <ZoneSection pickedUp={pickedUp} placeOnto={placeOnto} zone={ZONES.QUEUE} title={`Up next · ${sortedQueue.length} waiting`} highlight={pickedUp && pickedUp.fromZone !== ZONES.QUEUE}>
          {sortedQueue.map((p, i) => {
            const pos = i + 1;
            const posLabel = pos <= TEAM_SIZE ? "Playing next" : pos <= TEAM_SIZE * 2 ? "Playing in 2" : `~${Math.ceil(pos / TEAM_SIZE)} games wait`;
            const metaParts = [];
            if (p.roundsWaited > 0) metaParts.push(`sat ${p.roundsWaited}`);
            if ((p.gamesPlayed || 0) > 0) metaParts.push(`played ${p.gamesPlayed}`);
            return (
              <PlayerRow isAdmin={isAdmin} pickedUp={pickedUp} pickUp={pickUp} placeOnto={placeOnto} key={p.id} player={p} zone={ZONES.QUEUE} pos={pos}
                meta={`${posLabel}${metaParts.length ? " · " + metaParts.join(" · ") : ""}`}
                badge={p.streakedOut ? <span style={s.badgeStreaked}>🔥 won 2 straight</span> : null}
                actions={isAdmin && <>
                  <button style={s.iconBtn} onClick={e => { e.stopPropagation(); skipRound(p.id); }}>⏸</button>
                  <button style={s.iconBtnRed} onClick={e => { e.stopPropagation(); leaveFromWaiting(p.id); }}>✕</button>
                </>}
              />
            );
          })}
        </ZoneSection>
      )}

      {/* Sitting out */}
      {sittingOut.length > 0 && (
        <ZoneSection pickedUp={pickedUp} placeOnto={placeOnto} zone={ZONES.SITTING} title={`Sitting out · ${sittingOut.length}`} highlight={pickedUp && pickedUp.fromZone !== ZONES.SITTING}>
          {sortQueue(sittingOut).map(p => (
            <PlayerRow isAdmin={isAdmin} pickedUp={pickedUp} pickUp={pickUp} placeOnto={placeOnto} key={p.id} player={p} zone={ZONES.SITTING}
              meta={`Sat ${p.roundsWaited} round${p.roundsWaited === 1 ? "" : "s"}`}
              actions={isAdmin && <>
                <button style={s.rejoinBtn} onClick={e => { e.stopPropagation(); rejoin(p.id); }}>Back in</button>
                <button style={s.iconBtnRed} onClick={e => { e.stopPropagation(); leaveFromWaiting(p.id); }}>✕</button>
              </>}
            />
          ))}
        </ZoneSection>
      )}

      {/* Left */}
      {left.length > 0 && (
        <ZoneSection pickedUp={pickedUp} placeOnto={placeOnto} zone={ZONES.LEFT} title={`Left · ${left.length}`} highlight={pickedUp && pickedUp.fromZone !== ZONES.LEFT}>
          {left.map(p => (
            <PlayerRow isAdmin={isAdmin} pickedUp={pickedUp} pickUp={pickUp} placeOnto={placeOnto} key={p.id} player={p} zone={ZONES.LEFT}
              meta={`Out ${gameCount - (p.leftAtGame || gameCount)} game${(gameCount - (p.leftAtGame || gameCount)) === 1 ? "" : "s"}`}
              actions={isAdmin && <>
                <button style={s.rejoinBtn} onClick={e => { e.stopPropagation(); rejoinFromLeft(p.id); }}>Back in</button>
                <button style={s.iconBtnRed} onClick={e => { e.stopPropagation(); removeFromLeft(p.id); }}>✕</button>
              </>}
            />
          ))}
        </ZoneSection>
      )}

      {/* Join */}
      {(() => {
        const allActive = [...teamA, ...teamB, ...queue, ...sittingOut, ...left];
        const addedNames = new Set(allActive.map(p => p.name.toLowerCase()));
        const sortKey = (n) => n.replace(/^(Pastor|Dr|Mr|Mrs|Ms)\s+/i, "");
        const available = KNOWN_PLAYERS.filter(n => !addedNames.has(n.toLowerCase())).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
        if (available.length === 0) return null;
        return (
          <div style={s.card}>
            <p style={s.sectionLabel}>On the list, just running late?</p>
            <div style={s.chipGrid}>
              {available.map(name => (
                <button key={name} style={s.chip} onClick={() => addPlayer(name)}>{name}</button>
              ))}
            </div>
          </div>
        );
      })()}

      <div style={s.card}>
        <p style={s.sectionLabel}>Join the run</p>
        <div style={s.row}>
          <input style={s.input} placeholder="Your name" value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addPlayer(nameInput)} />
          <button style={s.addBtn} onClick={() => addPlayer(nameInput)}>+</button>
        </div>
      </div>
    </div>
  );
}

// ── PLAYER ROW ────────────────────────────────────────────────────────────────
function PlayerRow({ player, zone, pos, primary, meta, badge, actions, isAdmin, pickedUp, pickUp, placeOnto }) {
  const held = pickedUp?.player.id === player.id;
  const target = pickedUp && !held;
  const pressTimer = useRef(null);
  const lastTap = useRef(0);

  const onPressStart = (e) => {
    if (!isAdmin || e.target.tagName === "BUTTON") return;
    pressTimer.current = setTimeout(() => pickUp(player, zone), LONG_PRESS_MS);
  };
  const onPressEnd = () => clearTimeout(pressTimer.current);

  const handleClick = () => {
    if (!isAdmin) return;
    const now = Date.now();
    if (held && now - lastTap.current < 300) {
      placeOnto(null, null, true);
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
    if (target) placeOnto(zone, player);
  };

  return (
    <div
      onPointerDown={onPressStart}
      onPointerUp={onPressEnd}
      onPointerLeave={onPressEnd}
      onPointerCancel={onPressEnd}
      onClick={handleClick}
      style={{
        ...s.qRow,
        background: held ? "#FFF3E0" : target ? "#F0F7FF" : "transparent",
        border: `1px solid ${held ? "#FF9500" : target ? "#007AFF" : "transparent"}`,
        cursor: isAdmin ? (held ? "grabbing" : target ? "pointer" : "grab") : "default",
        userSelect: "none",
        touchAction: isAdmin ? "none" : "pan-y",
      }}>
      {isAdmin && <span style={s.handle}>⠿</span>}
      {pos && <span style={s.qPos}>#{pos}</span>}
      <div style={s.qInfo}>
        <div style={s.qInfoTop}>
          <span style={{ ...s.qName, color: held ? "#FF9500" : "#1C1C1E" }}>{player.name}</span>
          {badge}
        </div>
        {meta && <span style={s.qMeta}>{meta}</span>}
      </div>
      {!held && actions}
    </div>
  );
}

// ── ZONE SECTION ──────────────────────────────────────────────────────────────
function ZoneSection({ zone, title, children, highlight, pickedUp, placeOnto }) {
  return (
    <div style={{ ...s.card, ...(highlight ? s.cardHighlight : {}) }}
      onClick={() => { if (pickedUp && pickedUp.fromZone !== zone) placeOnto(zone, null); }}>
      <p style={s.sectionLabel}>{title}</p>
      {children}
    </div>
  );
}

// ── COURT PLAYER ROW ──────────────────────────────────────────────────────────
function CourtPlayerRow({ player, zone, held, target, isAdmin, canSub, pickedUp, pickUp, placeOnto, onSub, onLeave, color }) {
  const pressTimer = useRef(null);
  const lastTap = useRef(0);

  const onPressStart = (e) => {
    if (!isAdmin || e.target.tagName === "BUTTON") return;
    pressTimer.current = setTimeout(() => pickUp(player, zone), LONG_PRESS_MS);
  };
  const onPressEnd = () => clearTimeout(pressTimer.current);

  const handleClick = (e) => {
    e.stopPropagation();
    if (!isAdmin) return;
    const now = Date.now();
    if (held && now - lastTap.current < 300) {
      placeOnto(null, null, true);
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
    if (target) placeOnto(zone, player);
  };

  return (
    <div
      onPointerDown={onPressStart} onPointerUp={onPressEnd}
      onPointerLeave={onPressEnd} onPointerCancel={onPressEnd}
      onClick={handleClick}
      style={{ ...tp.row, background: held ? "#FFF3E0" : target ? color : "transparent", border: `1px solid ${held ? "#FF9500" : target ? "#007AFF" : "transparent"}`, cursor: isAdmin ? "pointer" : "default", userSelect: "none", touchAction: isAdmin ? "none" : "pan-y" }}>
      <span style={{ ...tp.name, color: held ? "#FF9500" : "#1C1C1E" }}>{player.name}</span>
      {(player.winStreak || 0) > 0 && (
        <span style={tp.playerStreak}>🔥{player.winStreak}</span>
      )}
      {canSub && !pickedUp && (
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <button style={tp.subBtn} onClick={e => { e.stopPropagation(); onSub(); }}>sub</button>
          <button style={tp.leaveBtn} onClick={e => { e.stopPropagation(); onLeave(); }}>leave</button>
        </div>
      )}
    </div>
  );
}

// ── STYLES ────────────────────────────────────────────────────────────────────
const tp = {
  panel: { flex: 1, padding: "16px 14px", transition: "background 0.2s" },
  zoneTarget: { background: "rgba(0,122,255,0.05)", boxShadow: "inset 0 0 0 2px rgba(0,122,255,0.2)" },
  header: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" },
  label: { fontSize: 13, fontWeight: 700, letterSpacing: "0.02em", color: "#1C1C1E" },
  streak: { fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "2px 7px", color: "#fff", letterSpacing: "0.01em" },
  playerStreak: { fontSize: 11, fontWeight: 700, color: "#FF9500", flexShrink: 0 },
  hint: { fontSize: 10, color: "#007AFF", marginLeft: "auto" },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px", borderRadius: 10, marginBottom: 4, transition: "all 0.15s", gap: 6, minHeight: 46 },
  name: { fontSize: 15, flex: 1, whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.2, fontWeight: 500, color: "#1C1C1E" },
  subBtn: { background: "rgba(0,0,0,0.06)", border: "none", borderRadius: 7, color: "#8E8E93", fontSize: 11, fontWeight: 600, cursor: "pointer", padding: "3px 8px", flexShrink: 0 },
  leaveBtn: { background: "#FFEBEA", border: "none", borderRadius: 7, color: "#FF3B30", fontSize: 11, fontWeight: 600, cursor: "pointer", padding: "3px 8px", flexShrink: 0 },
};
const s = {
  // iOS-inspired: light, clean, generous whitespace
  root: { minHeight: "100vh", background: "#F2F2F7", color: "#1C1C1E", fontFamily: "-apple-system, 'SF Pro Display', 'Inter', sans-serif", maxWidth: 480, margin: "0 auto", paddingBottom: 48, overscrollBehavior: "contain", touchAction: "pan-y" },
  header: { textAlign: "center", padding: "48px 20px 24px", background: "#FFFFFF" },
  ball: { fontSize: 56, marginBottom: 8 },
  title: { margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em", color: "#1C1C1E" },
  sub: { margin: "6px 0 0", fontSize: 12, color: "#8E8E93", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500 },

  card: { margin: "12px 16px 0", background: "#FFFFFF", border: "none", borderRadius: 16, padding: "16px", transition: "all 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" },
  cardHighlight: { background: "#F0F7FF", boxShadow: "0 0 0 2px #007AFF" },
  cardRunning: { background: "#F0FFF4", boxShadow: "0 0 0 2px #34C759" },
  cardDone: { background: "#FFF0F0", boxShadow: "0 0 0 2px #FF3B30" },

  row: { display: "flex", gap: 10 },
  input: { flex: 1, background: "#F2F2F7", border: "none", borderRadius: 10, color: "#1C1C1E", padding: "12px 14px", fontSize: 16, outline: "none" },
  addBtn: { background: "#007AFF", border: "none", borderRadius: 10, color: "#fff", fontSize: 22, width: 46, cursor: "pointer", fontWeight: 700 },

  countRow: { margin: "14px 0 10px", fontSize: 15, display: "flex", alignItems: "baseline", gap: 4 },
  countNum: { fontSize: 34, fontWeight: 800, color: "#007AFF", letterSpacing: "-0.02em" },
  countLabel: { color: "#8E8E93", fontWeight: 400 },
  teamsTag: { marginLeft: 8, fontSize: 12, fontWeight: 600, background: "#EBF4FF", color: "#007AFF", borderRadius: 8, padding: "3px 9px" },
  chipGrid: { display: "flex", flexWrap: "wrap", gap: 8 },
  chip: { background: "#F2F2F7", border: "none", borderRadius: 20, color: "#1C1C1E", fontSize: 14, fontWeight: 500, padding: "9px 16px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, maxWidth: "100%" },

  playerRow: { display: "flex", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #F2F2F7" },
  playerNum: { fontSize: 12, color: "#8E8E93", width: 24, fontWeight: 600 },
  playerName: { flex: 1, fontSize: 16, fontWeight: 500, color: "#1C1C1E" },
  removeBtn: { background: "none", border: "none", color: "#C7C7CC", fontSize: 20, cursor: "pointer", padding: "0 4px" },
  warn: { fontSize: 13, color: "#8E8E93", marginTop: 10, textAlign: "center" },

  primaryBtn: { display: "block", width: "calc(100% - 32px)", margin: "16px 16px 0", background: "#007AFF", border: "none", borderRadius: 14, color: "#fff", fontSize: 17, fontWeight: 700, padding: "16px", cursor: "pointer", letterSpacing: "-0.01em" },
  primaryBtnDisabled: { background: "#E5E5EA", color: "#8E8E93", cursor: "default" },
  testBtn: { display: "block", width: "calc(100% - 32px)", margin: "10px 16px 0", background: "#FFFFFF", border: "none", borderRadius: 12, color: "#007AFF", fontSize: 14, fontWeight: 500, padding: "11px", cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" },
  adminUnlockBtn: { display: "block", width: "calc(100% - 32px)", margin: "10px 16px 0", background: "#FFFFFF", border: "none", borderRadius: 12, color: "#8E8E93", fontSize: 14, fontWeight: 500, padding: "11px", cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" },
  logoutBtn: { display: "block", width: "calc(100% - 32px)", margin: "8px 16px 0", background: "none", border: "none", borderRadius: 12, color: "#FF3B30", fontSize: 14, fontWeight: 500, padding: "10px", cursor: "pointer" },
  newSessionBtn: { display: "block", width: "calc(100% - 32px)", margin: "8px 16px 0", background: "#FFF0F0", border: "none", borderRadius: 10, color: "#FF3B30", fontSize: 13, fontWeight: 600, padding: "10px", cursor: "pointer" },
  lockBtn: { background: "none", border: "none", color: "#8E8E93", fontSize: 13, padding: "3px 8px", cursor: "pointer", fontWeight: 500 },

  adminBanner: { margin: "8px 16px 0", background: "#F0FFF4", border: "none", borderRadius: 10, padding: "8px 14px", fontSize: 12, color: "#34C759", fontWeight: 600, cursor: "pointer", boxShadow: "0 0 0 1px #34C75930" },
  adminBannerWarning: { background: "#FFF4E6", color: "#FF9500", boxShadow: "0 0 0 1px #FF950030" },
  pickedBanner: { position: "sticky", top: 0, zIndex: 40, background: "#FFF9E6", borderBottom: "1px solid #FFD60A", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, color: "#1C1C1E", fontWeight: 500 },
  pickedCancel: { background: "none", border: "none", color: "#FF9500", fontSize: 20, cursor: "pointer" },

  topBar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px 12px", background: "#FFFFFF", borderBottom: "1px solid #F2F2F7" },
  gameLabel: { fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em", color: "#1C1C1E" },
  totalLabel: { fontSize: 13, color: "#8E8E93", fontWeight: 400 },

  resultBanner: { margin: "10px 16px 0", background: "#FFFFFF", borderRadius: 12, padding: "10px 14px", fontSize: 13, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" },
  bannerWin: { color: "#34C759", fontWeight: 700 },
  bannerSep: { color: "#C7C7CC" },
  bannerLose: { color: "#8E8E93" },
  warnBanner: { margin: "10px 16px 0", background: "#FFF0F0", borderRadius: 10, padding: "8px 14px", fontSize: 13, color: "#FF3B30", fontWeight: 500 },

  // Court
  court: { display: "flex", alignItems: "stretch", margin: "12px 16px 0", background: "#FFFFFF", borderRadius: 16, overflow: "hidden", position: "relative", minHeight: 210, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" },
  halfLine: { position: "absolute", left: "50%", top: 16, bottom: 16, width: 1, background: "#E5E5EA", transform: "translateX(-50%)" },
  vsCircle: { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", background: "#F2F2F7", borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 },
  vsText: { fontSize: 10, fontWeight: 800, color: "#8E8E93", letterSpacing: "0.08em" },

  btnRow: { display: "flex", gap: 10, margin: "12px 16px 0" },
  winBtn: { flex: 1, border: "none", borderRadius: 14, color: "#fff", fontSize: 16, fontWeight: 700, padding: "16px 8px", cursor: "pointer", letterSpacing: "-0.01em" },
  undoBtn: { display: "block", width: "calc(100% - 32px)", margin: "8px 16px 0", background: "none", border: "none", borderRadius: 10, color: "#8E8E93", fontSize: 14, padding: "9px", cursor: "pointer" },

  // Timer
  timerDisplay: { display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 },
  timerTime: { fontSize: 64, fontWeight: 300, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.04em", lineHeight: 1, color: "#007AFF" },
  timerDoneLabel: { fontSize: 13, fontWeight: 600, color: "#FF3B30", letterSpacing: "0.04em", textTransform: "uppercase" },
  timerBtnRow: { display: "flex", gap: 8, marginBottom: 12 },
  timerBtnStart: { flex: 1, background: "#34C759", border: "none", borderRadius: 12, color: "#fff", fontSize: 15, fontWeight: 700, padding: "12px 4px", cursor: "pointer" },
  timerBtnPause: { flex: 1, background: "#F2F2F7", border: "none", borderRadius: 12, color: "#1C1C1E", fontSize: 15, fontWeight: 700, padding: "12px 4px", cursor: "pointer" },
  timerBtnReset: { flex: 1, background: "#FFEBEA", border: "none", borderRadius: 12, color: "#FF3B30", fontSize: 15, fontWeight: 600, padding: "12px 4px", cursor: "pointer" },
  timerBtnAdd: { flex: 1, background: "#E8F5E9", border: "none", borderRadius: 12, color: "#34C759", fontSize: 13, fontWeight: 600, padding: "12px 4px", cursor: "pointer" },
  timerBtnSub: { flex: 1, background: "#FFEBEA", border: "none", borderRadius: 12, color: "#FF3B30", fontSize: 13, fontWeight: 600, padding: "12px 4px", cursor: "pointer" },
  timerHint: { fontSize: 12, color: "#8E8E93", margin: 0 },

  sectionLabel: { fontSize: 12, fontWeight: 600, color: "#8E8E93", letterSpacing: "0.04em", textTransform: "uppercase", margin: "0 0 8px" },
  qRow: { display: "flex", alignItems: "center", padding: "10px 4px", gap: 8, marginBottom: 1, borderRadius: 8, transition: "all 0.1s" },
  qPos: { fontSize: 12, color: "#C7C7CC", width: 24, flexShrink: 0, fontWeight: 600 },
  qInfo: { flex: 1, display: "flex", flexDirection: "column", gap: 1, minWidth: 0 },
  qInfoTop: { display: "flex", alignItems: "center", gap: 6 },
  qName: { fontSize: 15, fontWeight: 500, color: "#1C1C1E", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  qMeta: { fontSize: 12, color: "#8E8E93", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  handle: { color: "#C7C7CC", fontSize: 13, flexShrink: 0 },

  badgeStreaked: { fontSize: 11, fontWeight: 600, background: "#FFF4E6", color: "#FF9500", borderRadius: 6, padding: "2px 7px", whiteSpace: "nowrap", flexShrink: 0 },

  iconBtn: { background: "none", border: "none", borderRadius: 6, color: "#8E8E93", fontSize: 13, padding: "2px 6px", cursor: "pointer", flexShrink: 0 },
  iconBtnRed: { background: "none", border: "none", borderRadius: 6, color: "#FF3B30", fontSize: 12, padding: "2px 6px", cursor: "pointer", flexShrink: 0 },
  rejoinBtn: { background: "#E8F5E9", border: "none", borderRadius: 8, color: "#34C759", fontSize: 12, fontWeight: 600, padding: "4px 10px", cursor: "pointer", flexShrink: 0 },

  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50, backdropFilter: "blur(8px)" },
  modal: { background: "#FFFFFF", borderRadius: "20px 20px 0 0", padding: "24px 20px 40px", width: "100%", maxWidth: 480, display: "flex", flexDirection: "column", gap: 10, alignItems: "center" },
  modalTitle: { margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#1C1C1E", textAlign: "center", letterSpacing: "-0.01em" },
  modalDesc: { color: "#8E8E93", fontSize: 14, textAlign: "center", margin: "0 0 4px" },

  pinDots: { display: "flex", gap: 16, marginBottom: 10 },
  pinDot: { width: 14, height: 14, borderRadius: "50%", border: "2px solid #C7C7CC", background: "none" },
  pinDotFilled: { background: "#007AFF", border: "2px solid #007AFF" },
  pinError: { color: "#FF3B30", fontSize: 13, margin: "0 0 4px" },
  pinGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, width: "100%", maxWidth: 280 },
  pinKey: { background: "#F2F2F7", border: "none", borderRadius: 14, color: "#1C1C1E", fontSize: 24, fontWeight: 400, padding: "18px", cursor: "pointer" },
  pinKeyEmpty: { background: "none", border: "none", cursor: "default" },

  btnPrimary: { width: "100%", background: "#F2F2F7", border: "none", borderRadius: 14, color: "#1C1C1E", fontSize: 15, fontWeight: 600, padding: "14px 16px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 },
  btnWarning: { width: "100%", background: "#FFF0F0", border: "none", borderRadius: 14, color: "#FF3B30", fontSize: 15, fontWeight: 600, padding: "14px 16px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 },
  btnCancel: { background: "none", border: "none", color: "#8E8E93", fontSize: 15, padding: "10px", cursor: "pointer" },
  hint: { fontSize: 12, fontWeight: 400, color: "#8E8E93" },
};
