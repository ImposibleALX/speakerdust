const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const statusText = document.getElementById('status');

// Helper to generate a random ID and color
const myId = crypto.randomUUID();
const myColor = `hsl(${Math.random() * 360}, 80%, 60%)`;

let players = {};
let myX = 400;
let myY = 300;

// Reemplace esta URL con la URL de su Worker de Cloudflare después de desplegar
// Para pruebas locales usando wrangler dev, usualmente es ws://localhost:8787
const WORKER_URL = "ws://localhost:8787";
const ROOM_ID = "sala-publica-1";

let socket;

function connect() {
    socket = new WebSocket(`${WORKER_URL}/room/${ROOM_ID}`);

    socket.addEventListener('open', () => {
        statusText.textContent = "Connected to " + ROOM_ID;
        statusText.style.color = "#4ecca3";
        // Enviar estado inicial
        sendState();
    });

    socket.addEventListener('message', (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.id && data.id !== myId) {
                players[data.id] = data;
            }
        } catch (e) {
            console.error("Invalid message format", e);
        }
    });

    socket.addEventListener('close', () => {
        statusText.textContent = "Disconnected. Reconnecting...";
        statusText.style.color = "#e94560";
        setTimeout(connect, 2000);
    });
}

function sendState() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            id: myId,
            x: myX,
            y: myY,
            color: myColor
        }));
    }
}

// Control de movimiento básico
const keys = {};
window.addEventListener('keydown', e => keys[e.key] = true);
window.addEventListener('keyup', e => keys[e.key] = false);

function update() {
    const speed = 5;
    let moved = false;

    if (keys['ArrowUp'] || keys['w']) { myY -= speed; moved = true; }
    if (keys['ArrowDown'] || keys['s']) { myY += speed; moved = true; }
    if (keys['ArrowLeft'] || keys['a']) { myX -= speed; moved = true; }
    if (keys['ArrowRight'] || keys['d']) { myX += speed; moved = true; }

    // Restringir a los bordes
    myX = Math.max(10, Math.min(canvas.width - 10, myX));
    myY = Math.max(10, Math.min(canvas.height - 10, myY));

    if (moved) {
        sendState();
    }
}

function draw() {
    // Limpiar canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dibujar otros jugadores
    for (const id in players) {
        const p = players[id];
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
        ctx.fill();
    }

    // Dibujar mi jugador
    ctx.fillStyle = myColor;
    ctx.beginPath();
    ctx.arc(myX, myY, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

// Iniciar
connect();
gameLoop();
