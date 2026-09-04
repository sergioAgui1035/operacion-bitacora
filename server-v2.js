import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const PORT = Number(process.env.PORT) || 3000;
const rooms = new Map();

const LEVELS = [
  { name: 'Tablero inicial', cards: 25, minutes: 12, first: 9, second: 8, neutral: 7, assassins: 1 },
  { name: 'Doble riesgo', cards: 25, minutes: 12, first: 9, second: 8, neutral: 6, assassins: 2 },
  { name: 'Mapa ampliado', cards: 30, minutes: 13, first: 11, second: 10, neutral: 7, assassins: 2 },
  { name: 'Zona peligrosa', cards: 30, minutes: 13, first: 11, second: 10, neutral: 6, assassins: 3 },
  { name: 'Desafío experto', cards: 36, minutes: 14, first: 13, second: 12, neutral: 8, assassins: 3 },
  { name: 'Misión final', cards: 36, minutes: 14, first: 13, second: 12, neutral: 7, assassins: 4 }
];

const BOT_NAMES = ['Wuen', 'Dieguín', 'David', 'Estiben', 'Juanca', 'Bray', 'Alejo', 'Jaider'];
const WORDS = [
  'playa','montaña','pizza','sushi','arepa','café','helado','viaje','avión','hotel','karaoke','guitarra','reguetón','rock','concierto','película','serie','anime','superhéroe','villano','meme','emoji','selfie','TikTok','podcast',
  'videojuego','fútbol','ajedrez','parqués','dominó','perro','gato','capibara','pingüino','tiburón','dragón','fantasma','alien','pirata','ninja','magia','tesoro','castillo','espacio','planeta','cohete','luna','sol','tormenta',
  'arcoíris','fiesta','cumpleaños','vacaciones','camping','aventura','secreto','sorpresa','suerte','caos','risa','chocolate','hamburguesa','taco','limón','mango','cerveza','coctel','desayuno','parrilla','postre','museo','teatro','libro',
  'fotografía','pintura','baile','comedia','misterio','romance','terror','bicicleta','moto','carro','barco','tren','maratón','piscina','gimnasio','finca','hamaca','Bogotá','Medellín','Cartagena','Colombia','Japón','México','Brasil','Nueva York','Amazonas','Caribe'
];

function shuffle(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function wordVariants(value) {
  const normalized = String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const variants = new Set([normalized]);
  if (normalized.length > 3 && normalized.endsWith('s')) variants.add(normalized.slice(0, -1));
  if (normalized.length > 4 && normalized.endsWith('es')) variants.add(normalized.slice(0, -2));
  return variants;
}

function clueAppearsOnBoard(room, clue) {
  const clueVariants = wordVariants(clue);
  return room.board.some(card => {
    const cardVariants = wordVariants(card.word);
    return [...clueVariants].some(variant => cardVariants.has(variant));
  });
}

function makeRoom(id) {
  return { id, hostId: null, phase: 'lobby', players: new Map(), teams: { red: [], blue: [] }, captainIds: { red: null, blue: null }, board: [], turnTeam: 'red', clue: null, guessesLeft: 0, round: 0, totalRounds: LEVELS.length, level: null, scores: { red: 0, blue: 0 }, roundEndsAt: null, timer: null, winner: null, log: [], createdAt: Date.now() };
}

function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, makeRoom(id));
  return rooms.get(id);
}

function log(room, message) {
  room.log.push({ id: crypto.randomUUID(), message });
  room.log = room.log.slice(-14);
}

function cleanPlayer(player) {
  return { id: player.id, name: player.name, bot: Boolean(player.bot), connected: player.bot || Boolean(player.socketId), team: player.team || null };
}

function stateFor(room, viewerId) {
  const captainView = room.captainIds.red === viewerId || room.captainIds.blue === viewerId;
  return { id: room.id, hostId: room.hostId, phase: room.phase, players: [...room.players.values()].map(cleanPlayer), teams: room.teams, captainIds: room.captainIds, board: room.phase === 'lobby' ? [] : room.board.map(card => ({ word: card.word, revealed: card.revealed, role: card.revealed || captainView ? card.role : null })), turnTeam: room.turnTeam, clue: room.clue, guessesLeft: room.guessesLeft, round: room.round, totalRounds: room.totalRounds, level: room.level, scores: room.scores, roundEndsAt: room.roundEndsAt, winner: room.winner, log: room.log, testMode: [...room.players.values()].some(player => player.bot), me: room.players.has(viewerId) ? cleanPlayer(room.players.get(viewerId)) : null };
}

function broadcast(room) {
  for (const player of room.players.values()) if (player.socketId) io.to(player.socketId).emit('state', stateFor(room, player.id));
}

function assignTeams(room) {
  room.teams = { red: [], blue: [] };
  shuffle([...room.players.values()]).forEach((player, index) => {
    player.team = index % 2 ? 'blue' : 'red';
    room.teams[player.team].push(player.id);
  });
  for (const team of ['red', 'blue']) {
    const members = room.teams[team];
    room.captainIds[team] = members[Math.floor(Math.random() * members.length)] || null;
  }
  log(room, '🔀 Equipos y capitanes asignados al azar.');
}

function makeBoard(round) {
  const level = LEVELS[round - 1];
  const starter = round % 2 ? 'red' : 'blue';
  const other = starter === 'red' ? 'blue' : 'red';
  const roles = shuffle([...Array(level.first).fill(starter), ...Array(level.second).fill(other), ...Array(level.neutral).fill('neutral'), ...Array(level.assassins).fill('assassin')]);
  return shuffle(WORDS).slice(0, level.cards).map((word, index) => ({ word, role: roles[index], revealed: false }));
}

function beginRound(room) {
  room.round += 1;
  room.level = LEVELS[room.round - 1];
  room.phase = 'playing';
  room.turnTeam = room.round % 2 ? 'red' : 'blue';
  room.board = makeBoard(room.round);
  room.clue = null;
  room.guessesLeft = 0;
  room.winner = null;
  const duration = room.level.minutes * 60 * 1000;
  room.roundEndsAt = Date.now() + duration;
  clearTimeout(room.timer);
  room.timer = setTimeout(() => finishRound(room, null, '⏱️ Finalizó el tiempo de la ronda.'), duration);
  log(room, `🚀 Ronda ${room.round}/${room.totalRounds}: ${room.level.name} · ${room.level.cards} palabras · ${room.level.minutes} min.`);
  broadcast(room);
  runBots(room);
}

function finishRound(room, winner, reason) {
  if (room.phase !== 'playing') return;
  clearTimeout(room.timer);
  room.roundEndsAt = null;
  if (!winner) {
    const left = team => room.board.filter(card => card.role === team && !card.revealed).length;
    winner = left('red') === left('blue') ? null : left('red') < left('blue') ? 'red' : 'blue';
  }
  log(room, reason);
  if (winner) { room.scores[winner] += 3; log(room, `🏅 El equipo ${winner === 'red' ? 'rojo' : 'azul'} gana 3 puntos de ronda.`); }
  room.clue = null;
  room.guessesLeft = 0;
  if (room.round >= room.totalRounds) {
    room.phase = 'finished';
    room.winner = room.scores.red === room.scores.blue ? 'tie' : room.scores.red > room.scores.blue ? 'red' : 'blue';
  } else {
    room.phase = 'roundEnd';
    room.winner = winner;
  }
  broadcast(room);
}

function changeTurn(room) {
  room.turnTeam = room.turnTeam === 'red' ? 'blue' : 'red';
  room.clue = null;
  room.guessesLeft = 0;
  log(room, `Turno del equipo ${room.turnTeam === 'red' ? 'rojo' : 'azul'}.`);
  broadcast(room);
  runBots(room);
}

function reveal(room, player, index) {
  const card = room.board[index];
  if (!card || card.revealed || room.phase !== 'playing' || player.team !== room.turnTeam || !room.clue) return;
  card.revealed = true;
  room.guessesLeft = Math.max(0, room.guessesLeft - 1);
  log(room, `${player.name} reveló “${card.word}”.`);
  if (card.role === room.turnTeam) {
    room.scores[room.turnTeam] += 1;
    if (!room.board.some(item => item.role === room.turnTeam && !item.revealed)) return finishRound(room, room.turnTeam, '🎯 Encontraron todas sus palabras.');
    if (!room.guessesLeft) return changeTurn(room);
    return broadcast(room);
  }
  if (card.role === 'assassin') return finishRound(room, room.turnTeam === 'red' ? 'blue' : 'red', '💥 Encontraron la carta prohibida.');
  if (card.role === 'red' || card.role === 'blue') room.scores[card.role] += 1;
  changeTurn(room);
}

function runBots(room) {
  if (room.phase !== 'playing') return;
  const captain = room.players.get(room.captainIds[room.turnTeam]);
  if (captain?.bot && !room.clue) {
    setTimeout(() => {
      if (room.phase !== 'playing' || room.clue || room.captainIds[room.turnTeam] !== captain.id) return;
      const candidates = ['aventura', 'sabor', 'cultura', 'diversión', 'recuerdo', 'ritmo', 'naturaleza', 'energía'].filter(clue => !clueAppearsOnBoard(room, clue));
      room.clue = { text: candidates[Math.floor(Math.random() * candidates.length)] || 'conexión', count: 2, by: captain.name };
      room.guessesLeft = 3;
      log(room, `🗣️ ${captain.name}: “${room.clue.text} 2”.`);
      broadcast(room);
      runBots(room);
    }, 1300);
    return;
  }
  const humanOperative = room.teams[room.turnTeam].some(id => { const p = room.players.get(id); return p && !p.bot && id !== room.captainIds[room.turnTeam]; });
  if (!room.clue || humanOperative || !captain?.bot) return;
  const bots = room.teams[room.turnTeam].map(id => room.players.get(id)).filter(player => player?.bot && player.id !== room.captainIds[room.turnTeam]);
  if (!bots.length) return;
  setTimeout(() => {
    if (room.phase !== 'playing' || !room.clue) return;
    const hidden = room.board.map((card, index) => ({ card, index })).filter(item => !item.card.revealed);
    const correct = hidden.filter(item => item.card.role === room.turnTeam);
    const pool = Math.random() < 0.78 && correct.length ? correct : hidden;
    const choice = pool[Math.floor(Math.random() * pool.length)];
    if (choice) reveal(room, bots[Math.floor(Math.random() * bots.length)], choice.index);
    if (room.phase === 'playing' && room.clue) runBots(room);
  }, 1600);
}

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, response) => response.json({ ok: true, rooms: rooms.size }));

io.on('connection', socket => {
  socket.on('join', ({ roomId, name, clientId }) => {
    const id = String(roomId || 'sala').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32) || 'sala';
    const safeName = String(name || '').trim().slice(0, 20);
    const playerId = String(clientId || crypto.randomUUID()).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64);
    if (!safeName) return socket.emit('errorMessage', 'Escribe tu nombre.');
    const room = getRoom(id);
    if (room.phase !== 'lobby' && !room.players.has(playerId)) return socket.emit('errorMessage', 'La partida ya comenzó.');
    if (!room.hostId && safeName.toLowerCase() !== 'checho') return socket.emit('errorMessage', 'Checho debe crear la sala.');
    if (!room.players.has(playerId) && room.players.size >= 10) return socket.emit('errorMessage', 'La sala ya tiene 10 participantes.');
    if ([...room.players.values()].some(player => player.id !== playerId && player.name.toLowerCase() === safeName.toLowerCase())) return socket.emit('errorMessage', 'Ese nombre ya está en la sala.');
    const player = room.players.get(playerId) || { id: playerId, bot: false, team: null };
    Object.assign(player, { name: safeName, socketId: socket.id });
    room.players.set(playerId, player);
    room.hostId ||= playerId;
    socket.join(room.id);
    Object.assign(socket.data, { roomId: room.id, playerId });
    log(room, `${safeName} entró a la sala.`);
    broadcast(room);
  });

  socket.on('addBots', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.hostId !== socket.data.playerId || room.phase !== 'lobby') return;
    for (const name of BOT_NAMES) {
      if (room.players.size >= 9) break;
      const id = `bot-${name.normalize('NFD').toLowerCase().replace(/[^a-z]/g, '')}`;
      room.players.set(id, { id, name: `${name} (bot)`, bot: true, socketId: null, team: null });
    }
    log(room, '🤖 Se agregaron 8 participantes simulados.');
    broadcast(room);
  });

  socket.on('shuffleTeams', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.hostId !== socket.data.playerId || room.phase !== 'lobby' || room.players.size < 4) return;
    assignTeams(room);
    broadcast(room);
  });

  socket.on('startGame', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.hostId !== socket.data.playerId || room.phase !== 'lobby' || room.players.size < 4) return;
    if (!room.teams.red.length) assignTeams(room);
    room.round = 0;
    room.scores = { red: 0, blue: 0 };
    beginRound(room);
  });

  socket.on('nextRound', () => {
    const room = rooms.get(socket.data.roomId);
    if (room?.hostId === socket.data.playerId && room.phase === 'roundEnd') beginRound(room);
  });

  socket.on('giveClue', ({ text, count }) => {
    const room = rooms.get(socket.data.roomId);
    const player = room?.players.get(socket.data.playerId);
    const clue = String(text || '').trim().split(/\s+/)[0].slice(0, 24);
    if (!room || !player || room.phase !== 'playing' || room.captainIds[room.turnTeam] !== player.id || room.clue || !clue) return;
    if (clueAppearsOnBoard(room, clue)) return socket.emit('errorMessage', 'La pista no puede ser una palabra del tablero, aunque cambien sus mayúsculas, acentos o número.');
    room.clue = { text: clue, count: Math.max(1, Math.min(9, Number(count) || 1)), by: player.name };
    room.guessesLeft = room.clue.count + 1;
    log(room, `🗣️ ${player.name}: “${room.clue.text} ${room.clue.count}”.`);
    broadcast(room);
    runBots(room);
  });

  socket.on('guess', ({ index }) => {
    const room = rooms.get(socket.data.roomId);
    const player = room?.players.get(socket.data.playerId);
    if (!room || !player) return;
    const captain = room.captainIds[player.team] === player.id;
    if (captain && ![...room.players.values()].some(item => item.bot)) return;
    reveal(room, player, Number(index));
  });

  socket.on('endTurn', () => {
    const room = rooms.get(socket.data.roomId);
    const player = room?.players.get(socket.data.playerId);
    if (room && player && room.phase === 'playing' && player.team === room.turnTeam && room.clue) changeTurn(room);
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomId);
    const player = room?.players.get(socket.data.playerId);
    if (player && !player.bot) player.socketId = null;
    if (room) broadcast(room);
  });
});

setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [id, room] of rooms) if (room.createdAt < cutoff && ![...room.players.values()].some(player => player.socketId)) rooms.delete(id);
}, 30 * 60 * 1000).unref();

httpServer.listen(PORT, '0.0.0.0', () => console.log(`Operación Bitácora disponible en el puerto ${PORT}`));
