import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';

const port = 3102;
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server-v2.js'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
let client;

function waitForState(predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout esperando el estado esperado')), timeout);
    const handler = state => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      client.off('state', handler);
      resolve(state);
    };
    client.on('state', handler);
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('El servidor de prueba no inició');
}

try {
  await waitForServer();
  client = io(baseUrl, { transports: ['websocket'] });
  await new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', reject);
  });

  const joined = waitForState(state => state.me?.name === 'Checho');
  client.emit('join', { roomId: 'prueba-automatica', name: 'Checho', clientId: 'smoke-checho' });
  assert.equal((await joined).hostId, 'smoke-checho');

  const botsAdded = waitForState(state => state.players.length === 9);
  client.emit('addBots');
  assert.equal((await botsAdded).players.filter(player => player.bot).length, 8);

  let lobby;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const shuffled = waitForState(state => state.teams.red.length > 0 && state.teams.blue.length > 0);
    client.emit('shuffleTeams');
    lobby = await shuffled;
    if (lobby.captainIds.red === 'smoke-checho') break;
  }
  assert.equal(lobby.teams.red.length + lobby.teams.blue.length, 9);
  assert.ok(lobby.teams.red.includes(lobby.captainIds.red));
  assert.ok(lobby.teams.blue.includes(lobby.captainIds.blue));
  assert.equal(lobby.captainIds.red, 'smoke-checho');

  const started = waitForState(state => state.phase === 'playing');
  client.emit('startGame');
  const game = await started;
  assert.equal(game.round, 1);
  assert.equal(game.totalRounds, 6);
  assert.equal(game.level.name, 'Tablero inicial');
  assert.equal(game.level.minutes, 12);
  assert.equal(game.board.length, 25);
  assert.ok(game.roundEndsAt > Date.now());
  assert.deepEqual(game.scores, { red: 0, blue: 0 });
  const clueRejected = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('La pista idéntica a una tarjeta no fue rechazada')), 3000);
    client.once('errorMessage', text => { clearTimeout(timer); resolve(text); });
  });
  client.emit('giveClue', { text: game.board[0].word, count: 1 });
  assert.match(await clueRejected, /no puede ser una palabra del tablero/i);
  console.log('OK: sala, 8 bots, equipos, capitanes y ronda inicial verificados.');
} finally {
  client?.close();
  server.kill('SIGTERM');
}
