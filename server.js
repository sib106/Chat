const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'messages.json');

// Статика, которую отдаёт сервер (только эти файлы — server.js и messages.json наружу не видны)
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/script.js': ['script.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
};

function readMessages() {
  if (!fs.existsSync(DB_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeMessages(messages) {
  fs.writeFileSync(DB_FILE, JSON.stringify(messages, null, 2));
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && STATIC_FILES[req.url]) {
    const [file, type] = STATIC_FILES[req.url];
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(path.join(__dirname, file)).pipe(res);
    return;
  }

  if (req.method === 'GET' && req.url === '/api/messages') {
    sendJson(res, 200, readMessages());
    return;
  }

  if (req.method === 'POST' && req.url === '/api/messages') {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > 1e5) req.destroy(); // защита от слишком больших запросов
    });
    req.on('end', () => {
      let text;
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        text = String(JSON.parse(body).text || '').trim();
      } catch {
        return sendJson(res, 400, { error: 'Некорректный JSON' });
      }
      if (!text) return sendJson(res, 400, { error: 'Пустое сообщение' });

      const message = { id: Date.now(), text, createdAt: new Date().toISOString() };
      const messages = readMessages();
      messages.push(message);
      writeMessages(messages);
      sendJson(res, 201, message);
    });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
