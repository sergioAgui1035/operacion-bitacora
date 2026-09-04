# Operación Bitácora

Juego social de asociación de palabras para 4 a 10 personas. Todo el contenido es recreativo: viajes, comida, música, películas, hobbies, animales, lugares y cultura general. No usa información laboral ni integraciones corporativas.

## Jugar en local

Requiere Node.js 22 o superior.

```bash
npm install
npm start
```

Abre `http://localhost:3000/?room=off-topic` y comparte exactamente esa URL con los demás.

## Partida de aproximadamente 40 minutos

- Checho crea la sala y es el anfitrión.
- Checho puede revolver los participantes; los equipos y capitanes se asignan al azar.
- Se juegan hasta 6 rondas progresivas. Cada ronda conserva el cronómetro regresivo y puede terminar antes si un equipo completa su objetivo.
- La primera ronda tiene 25 palabras y 12 minutos disponibles; está diseñada para durar cerca de 8 minutos incluso con un grupo hábil.
- Los tableros aumentan hasta 36 palabras y las rondas avanzadas incluyen hasta 4 cartas prohibidas.
- Cada acierto vale 1 punto y ganar una ronda concede 3 puntos adicionales.
- El equipo con más puntos después de las seis rondas gana.

## Prueba rápida con 8 bots

1. Entra como **Checho**.
2. Pulsa **Añadir 8 bots**.
3. Pulsa **Revolver equipos** las veces que quieras.
4. Pulsa **Iniciar partida**.
5. Si eres capitán, escribe una pista de una palabra y un número. En modo de prueba también podrás elegir tarjetas.
6. Si el capitán es un bot, espera su pista y selecciona una tarjeta cuando sea el turno de tu equipo.
7. Los turnos compuestos únicamente por bots se resuelven automáticamente.

## Cómo jugar

El capitán ve qué palabras corresponden a cada equipo y da una pista de una sola palabra más un número. Por ejemplo, `mar 2` indica que dos tarjetas se relacionan con “mar”. La pista no puede coincidir con una tarjeta del tablero, incluso si cambia mayúsculas, acentos o usa un plural simple. Los demás miembros conversan y seleccionan las tarjetas.

- Palabra propia: suma 1 punto y el equipo puede continuar.
- Palabra neutral: termina el turno.
- Palabra rival: el rival recibe 1 punto y termina el turno.
- Carta prohibida: el rival gana inmediatamente la ronda.

## Publicar en Render

1. Crea un repositorio personal de GitHub y sube el contenido del proyecto. No subas `node_modules` ni archivos `.env`.
2. En [Render](https://render.com/), elige **New → Blueprint**.
3. Conecta el repositorio. Render detectará `render.yaml` y el `Dockerfile`.
4. Confirma el servicio y espera a que `/health` aparezca como saludable.
5. Comparte la URL `https://nombre-del-servicio.onrender.com/?room=off-topic`.

El plan gratuito sirve para una actividad ocasional, aunque puede tardar en despertar después de un periodo sin uso. Para evitar esa espera habría que usar un plan pago; consulta el precio vigente mostrado por Render antes de confirmarlo.

## Docker en un servidor propio

Con Docker y Docker Compose instalados:

```bash
docker compose up -d --build
```

El juego queda disponible en el puerto `3000`. Las salas viven en memoria y se limpian cuando el servicio reinicia; para una actividad puntual esto evita cuentas y bases de datos.
