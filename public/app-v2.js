const socket = io();
const app = document.querySelector('#app');
const roomFromUrl = new URLSearchParams(location.search).get('room');
const roomId = roomFromUrl || `off-topic-${Math.random().toString(36).slice(2, 7)}`;
const clientId = localStorage.getItem('offTopicClientId') || crypto.randomUUID();
localStorage.setItem('offTopicClientId', clientId);
let state = null;
let message = '';
let timerHandle = null;
let audioContext = null;
let soundEnabled = localStorage.getItem('operacionBitacoraSound') !== 'off';
let lastCountdownBeep = null;

if (!roomFromUrl) history.replaceState({}, '', `?room=${encodeURIComponent(roomId)}`);

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const teamLabel = team => team === 'red' ? 'Rojo' : team === 'blue' ? 'Azul' : 'Sin equipo';
const playerById = id => state?.players.find(player => player.id === id);
const isHost = () => state?.hostId === state?.me?.id;
const isCaptain = () => state?.captainIds?.[state?.me?.team] === state?.me?.id;
const myTurn = () => state?.me?.team === state?.turnTeam;

function ensureAudio() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}

function tone(frequency, duration = 0.12, delay = 0, type = 'sine', volume = 0.035) {
  if (!soundEnabled) return;
  const context = ensureAudio();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime + delay;
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function playCue(cue) {
  if (!soundEnabled) return;
  const cues = {
    clue: [[523, .12, 0], [659, .15, .1]],
    correct: [[523, .11, 0], [659, .11, .08], [784, .18, .16]],
    wrong: [[220, .18, 0, 'triangle'], [165, .25, .13, 'triangle']],
    assassin: [[196, .28, 0, 'sawtooth', .025], [131, .45, .18, 'sawtooth', .03]],
    turn: [[392, .1, 0], [440, .13, .08]],
    start: [[392, .12, 0], [523, .12, .1], [659, .24, .2]],
    win: [[523, .15, 0], [659, .15, .12], [784, .15, .24], [1047, .35, .36]],
    tick: [[880, .045, 0, 'sine', .018]]
  };
  (cues[cue] || []).forEach(args => tone(...args));
}

function reactToState(previous, next) {
  if (!previous) return;
  if (previous.phase !== next.phase) {
    if (next.phase === 'playing') playCue('start');
    else if (next.phase === 'roundEnd' || next.phase === 'finished') playCue('win');
    return;
  }
  if (next.phase !== 'playing') return;
  const revealed = next.board.find((card, index) => card.revealed && !previous.board?.[index]?.revealed);
  if (revealed?.role === 'assassin') playCue('assassin');
  else if (revealed?.role === previous.turnTeam) playCue('correct');
  else if (revealed) playCue('wrong');
  else if (!previous.clue && next.clue) playCue('clue');
  else if (previous.turnTeam !== next.turnTeam) playCue('turn');
}

function bindSoundButton() {
  document.querySelector('#sound')?.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem('operacionBitacoraSound', soundEnabled ? 'on' : 'off');
    if (soundEnabled) playCue('turn');
    render();
  });
}

socket.on('state', nextState => {
  reactToState(state, nextState);
  state = nextState;
  message = '';
  render();
});
socket.on('errorMessage', text => {
  message = text;
  render();
});

function playerChip(player, captainId) {
  return `<li class="player-chip ${player.id === captainId ? 'captain' : ''} ${player.connected ? '' : 'offline'}">
    <span class="avatar">${escapeHtml(player.name.slice(0, 1).toUpperCase())}</span>
    <span>${escapeHtml(player.name)}${player.bot ? ' <small>BOT</small>' : ''}</span>
    ${player.id === captainId ? '<b>Capitán</b>' : ''}
  </li>`;
}

function lobbyView() {
  const joined = Boolean(state?.me);
  const participants = state?.players || [];
  const teamsReady = Boolean(state?.teams.red.length && state?.teams.blue.length);
  const red = teamsReady ? state.teams.red.map(id => playerChip(playerById(id), state.captainIds.red)).join('') : '';
  const blue = teamsReady ? state.teams.blue.map(id => playerChip(playerById(id), state.captainIds.blue)).join('') : '';
  const waiting = participants.map(player => playerChip(player, null)).join('');
  const shareUrl = `${location.origin}${location.pathname}?room=${state?.id || roomId}`;

  app.innerHTML = `<main class="page lobby-page">
    <header class="hero">
      <div class="brand-mark">OB</div>
      <div>
        <p class="eyebrow">JUEGO SOCIAL · 4–10 PERSONAS</p>
        <h1>Operación<br><em>Bitácora</em></h1>
        <p class="hero-copy">Conecta palabras, interpreta pistas y evita la carta prohibida. Seis rondas progresivas para descubrir qué equipo piensa más parecido.</p>
      </div>
    </header>

    <section class="lobby-card">
      ${!joined ? `<div class="join-panel">
        <span class="step">01 · ENTRAR</span>
        <label>Tu nombre<input id="name" maxlength="20" value="Checho" autocomplete="nickname"></label>
        <label>Código de sala<input value="${escapeHtml(roomId)}" disabled></label>
        <button class="button primary wide" id="join">Crear o entrar a la sala <span>→</span></button>
        ${message ? `<p class="alert">${escapeHtml(message)}</p>` : ''}
      </div>` : `<div class="room-head">
        <div><span class="step">SALA</span><h2>${escapeHtml(state.id)}</h2></div>
        <button class="button ghost" id="copy">Copiar enlace</button>
      </div>
      <div class="lobby-status"><span class="pulse"></span>${participants.length} de 10 participantes conectados</div>
      ${teamsReady ? `<div class="teams-preview">
        <article class="team-card red"><header><span>Equipo</span><h3>Rojo</h3></header><ul>${red}</ul></article>
        <div class="versus">VS</div>
        <article class="team-card blue"><header><span>Equipo</span><h3>Azul</h3></header><ul>${blue}</ul></article>
      </div>` : `<ul class="waiting-list">${waiting}</ul>`}
      ${isHost() ? `<div class="host-controls">
        <button class="button secondary" id="shuffle" ${participants.length < 4 ? 'disabled' : ''}>Revolver equipos</button>
        <button class="button primary" id="start" ${participants.length < 4 ? 'disabled' : ''}>Iniciar partida <span>→</span></button>
      </div>` : '<p class="waiting-note">Checho organiza los equipos e inicia la partida.</p>'}`}
    </section>

    <section class="rules-strip">
      <div><b>6</b><span>rondas progresivas</span></div><div><b>12–14</b><span>minutos disponibles</span></div><div><b>25–36</b><span>palabras por tablero</span></div>
    </section>
  </main>`;

  document.querySelector('#join')?.addEventListener('click', () => socket.emit('join', { roomId, name: document.querySelector('#name').value, clientId }));
  document.querySelector('#copy')?.addEventListener('click', async event => {
    await navigator.clipboard.writeText(shareUrl);
    event.currentTarget.textContent = 'Enlace copiado ✓';
  });
  document.querySelector('#shuffle')?.addEventListener('click', () => socket.emit('shuffleTeams'));
  document.querySelector('#start')?.addEventListener('click', () => socket.emit('startGame'));
}

function scoreBoard() {
  return `<div class="scoreboard">
    <div class="score red"><span>ROJO</span><b>${state.scores.red}</b></div>
      <div class="round-pill">RONDA ${state.round}/${state.totalRounds} · ${escapeHtml(state.level?.name || '')}</div>
    <div class="score blue"><b>${state.scores.blue}</b><span>AZUL</span></div>
  </div>`;
}

function boardView() {
  const captainNow = state.captainIds[state.turnTeam] === state.me?.id;
  const canGuess = myTurn() && Boolean(state.clue) && (!isCaptain() || state.testMode);
  const cards = state.board.map((card, index) => {
    const role = card.role || '';
    const classes = ['word-card', card.revealed ? 'revealed' : '', role ? `role-${role}` : ''].filter(Boolean).join(' ');
    return `<button class="${classes}" data-card="${index}" ${!canGuess || card.revealed ? 'disabled' : ''}>
      <span>${escapeHtml(card.word)}</span>
      ${card.revealed ? `<small>${role === 'assassin' ? 'PROHIBIDA' : teamLabel(role)}</small>` : captainNow && role ? `<small>${role === 'assassin' ? 'PROHIBIDA' : teamLabel(role)}</small>` : ''}
    </button>`;
  }).join('');
  const redCaptain = playerById(state.captainIds.red)?.name || '—';
  const blueCaptain = playerById(state.captainIds.blue)?.name || '—';
  const currentCaptain = playerById(state.captainIds[state.turnTeam])?.name || '—';

  app.innerHTML = `<main class="game-page">
    <header class="game-topbar">
      <div class="game-brand"><div class="mini-brand">OB</div><span>OPERACIÓN BITÁCORA</span></div>
      ${scoreBoard()}
      <div class="top-actions"><button class="sound-toggle" id="sound" type="button" aria-label="${soundEnabled ? 'Silenciar sonidos' : 'Activar sonidos'}" title="${soundEnabled ? 'Silenciar sonidos' : 'Activar sonidos'}">${soundEnabled ? '🔊' : '🔇'}</button><div class="timer"><small>TIEMPO</small><b id="clock">${state.level?.minutes || 0}:00</b></div></div>
    </header>

    <section class="game-layout">
      <aside class="side-panel">
        <div class="turn-card ${state.turnTeam}"><span>TURNO ACTUAL</span><h2>Equipo ${teamLabel(state.turnTeam)}</h2><p>Capitán: ${escapeHtml(currentCaptain)}</p></div>
        <div class="identity-card"><span>TÚ ERES</span><h3>${escapeHtml(state.me?.name || '')}</h3><p>Equipo ${teamLabel(state.me?.team)} · ${isCaptain() ? 'Capitán' : 'Agente'}</p></div>
        <div class="captains"><p><i class="dot red"></i>${escapeHtml(redCaptain)}</p><p><i class="dot blue"></i>${escapeHtml(blueCaptain)}</p></div>
        <div class="quick-help"><h3>Qué hacer ahora</h3><p>${captainNow && !state.clue ? 'Da una pista de una sola palabra y un número.' : myTurn() && state.clue ? `Relaciona la pista con el tablero. Quedan ${state.guessesLeft} intentos.` : `Espera mientras juega el equipo ${teamLabel(state.turnTeam).toLowerCase()}.`}</p></div>
      </aside>

      <section class="board-area">
        <div class="clue-banner ${state.clue ? 'active' : ''}">
          <span>PISTA</span><strong>${state.clue ? `${escapeHtml(state.clue.text)} · ${state.clue.count}` : 'Esperando al capitán…'}</strong>
          ${state.clue ? `<small>${state.guessesLeft} selecciones disponibles</small>` : ''}
        </div>
        <div class="word-grid cards-${state.board.length}">${cards}</div>
        ${myTurn() && state.clue ? '<button class="button end-turn" id="end">Terminar turno voluntariamente</button>' : ''}
      </section>

      <aside class="activity-panel">
        ${captainNow && !state.clue ? `<div class="clue-form"><span class="step">TU TURNO</span><h2>Da una pista</h2><p>Solo una palabra que no aparezca en el tablero. El número indica cuántas tarjetas relacionas.</p><label>Pista<input id="clue" maxlength="24" placeholder="Ej. aventura"></label><label>Número<input id="count" type="number" min="1" max="9" value="2"></label><button class="button primary wide" id="send">Enviar pista</button>${message ? `<p class="alert clue-alert">${escapeHtml(message)}</p>` : ''}</div>` : ''}
        <div class="activity"><h3>Bitácora</h3><ol>${state.log.slice().reverse().map(entry => `<li>${escapeHtml(entry.message)}</li>`).join('')}</ol></div>
      </aside>
    </section>
  </main>`;

  document.querySelectorAll('[data-card]').forEach(button => button.addEventListener('click', () => socket.emit('guess', { index: Number(button.dataset.card) })));
  document.querySelector('#send')?.addEventListener('click', () => socket.emit('giveClue', { text: document.querySelector('#clue').value, count: document.querySelector('#count').value }));
  document.querySelector('#end')?.addEventListener('click', () => socket.emit('endTurn'));
  bindSoundButton();
  startClock();
}

function resultView(final = false) {
  clearInterval(timerHandle);
  const winnerText = state.winner === 'tie' ? 'Empate total' : `Equipo ${teamLabel(state.winner)}`;
  app.innerHTML = `<main class="result-page">
    <div class="result-card ${state.winner || 'tie'}">
      <span class="step">${final ? 'PARTIDA TERMINADA' : `RONDA ${state.round} COMPLETADA`}</span>
      <div class="trophy">${state.winner === 'tie' ? '🤝' : '🏆'}</div>
      <h1>${escapeHtml(winnerText)}</h1>
      <p>${final ? 'Gracias por jugar Operación Bitácora.' : 'Ganó esta ronda. El tablero siguiente tendrá palabras y posiciones nuevas.'}</p>
      ${scoreBoard()}
      ${isHost() && !final ? '<button class="button primary" id="next">Comenzar siguiente ronda →</button>' : ''}
      ${!isHost() && !final ? '<p class="waiting-note">Esperando que Checho inicie la siguiente ronda…</p>' : ''}
      ${final ? '<a class="button primary" href="?room=nueva-sala">Crear otra sala</a>' : ''}
    </div>
  </main>`;
  document.querySelector('#next')?.addEventListener('click', () => socket.emit('nextRound'));
}

function startClock() {
  clearInterval(timerHandle);
  const tick = () => {
    const clock = document.querySelector('#clock');
    if (!clock || !state?.roundEndsAt) return;
    const remaining = Math.max(0, state.roundEndsAt - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    clock.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
    clock.classList.toggle('urgent', remaining < 60000);
    const totalSeconds = Math.ceil(remaining / 1000);
    if (totalSeconds > 0 && totalSeconds <= 10 && totalSeconds !== lastCountdownBeep) {
      lastCountdownBeep = totalSeconds;
      playCue('tick');
    }
  };
  tick();
  timerHandle = setInterval(tick, 1000);
}

function render() {
  clearInterval(timerHandle);
  lastCountdownBeep = null;
  if (!state || state.phase === 'lobby') lobbyView();
  else if (state.phase === 'playing') boardView();
  else resultView(state.phase === 'finished');
}

render();

window.addEventListener('pointerdown', () => {
  if (soundEnabled) ensureAudio();
}, { once: true });
