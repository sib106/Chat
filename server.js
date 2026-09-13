const http = require('http');
const fs = require('fs');
const path = require('path');
const { runAgent, MODELS, DEFAULT_MODEL, findModel } = require('./agent');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'messages.json');

// Настройки модели
const HISTORY_LIMIT = 20; // сколько последних сообщений передавать модели как контекст

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

function saveMessage(role, text, extra = {}) {
  const message = { id: Date.now(), role, text, createdAt: new Date().toISOString(), ...extra };

  const messages = readMessages();
  messages.push(message);
  writeMessages(messages);
  return message;
}

// Живая трансляция событий агента всем открытым вкладкам
const listeners = new Set();

function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of listeners) client.write(line);
}

// Список моделей для интерфейса: профили агента плюс отметка, скачана ли модель
const OLLAMA_TAGS_URL = (process.env.OLLAMA_URL || 'http://localhost:11434/api/chat').replace('/api/chat', '/api/tags');

async function listModels() {
  let installed = new Set();

  try {
    const res = await fetch(OLLAMA_TAGS_URL, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      installed = new Set((data.models || []).map((m) => m.name));
    }
  } catch {
    // Ollama не отвечает — покажем список без отметок
  }

  return {
    defaultModel: DEFAULT_MODEL,
    models: MODELS.map((m) => ({ id: m.id, title: m.title, note: m.note, installed: installed.has(m.id) })),
  };
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

  if (req.method === 'GET' && req.url === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n'); // если связь оборвётся, браузер переподключится сам
    listeners.add(res);
    req.on('close', () => listeners.delete(res));
    return;
  }

  if (req.method === 'GET' && req.url === '/api/models') {
    listModels().then((data) => sendJson(res, 200, data));
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
    req.on('end', async () => {
      let text;
      let model;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        text = String(body.text || '').trim();
        model = body.model ? String(body.model) : DEFAULT_MODEL;
      } catch {
        return sendJson(res, 400, { error: 'Некорректный JSON' });
      }
      if (!text) return sendJson(res, 400, { error: 'Пустое сообщение' });
      // Модель приходит из браузера, поэтому принимаем только из своего списка
      if (!findModel(model)) return sendJson(res, 400, { error: `Неизвестная модель: ${model}` });

        const message = saveMessage('user', text);

      // история для агента: только текст, без трассировок
      const history = readMessages()
        .slice(-HISTORY_LIMIT)
        .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.text }));

      try {
        const { answer, trace } = await runAgent(history, broadcast, { model });
        const reply = saveMessage('assistant', answer, { trace, model });
        sendJson(res, 201, { message, reply });
      } catch (err) {
        console.error('Ошибка агента:', err.message);
        broadcast({ type: 'error', message: err.message, at: Date.now() });
        sendJson(res, 502, { error: 'Агент не ответил: ' + err.message });
      }
    });
    return;
  }


  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
