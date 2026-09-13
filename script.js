const form = document.getElementById('chatForm');
const input = document.getElementById('messageInput');
const chatWindow = document.getElementById('chatWindow');
const sendButton = document.getElementById('sendButton');

// Трассировка: что агент делал по шагам
function buildTrace(trace) {
    const details = document.createElement('details');
    details.className = 'trace';

    const summary = document.createElement('summary');
    const seconds = ((trace.totalMs || 0) / 1000).toFixed(1);
    const model = trace.model ? `${trace.model}, ` : '';
    summary.textContent = `Показать процесс: ${model}шагов ${trace.steps.length}, ${seconds} с`;
    details.appendChild(summary);

    trace.steps.forEach((s) => {
        const row = document.createElement('div');
        row.className = 'trace__step';

        if (s.type === 'llm') {
            row.textContent = `${s.step}. Модель (${s.ms} мс): ` + (s.toolCalls.length ? 'решила вызвать ' + s.toolCalls.join(', ') : 'дала финальный ответ');
        } else if (s.type === 'tool') {
            row.textContent = `${s.step}. Инструмент ${s.name}(${JSON.stringify(s.args)}) -> ${JSON.stringify(s.result)}`;
        } else {
            row.textContent = `${s.step}. Проверка ответа: ` + (s.passed ? 'пройдена' : 'нарушено — ' + s.failed.join(', ') + ', просим переделать');
        }

        details.appendChild(row);
    });

    return details;
}


function formatTime(date) {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function addMessage(text, type, date = new Date(), trace = null) {
    const message = document.createElement('div');
    message.className = `message message--${type}`;
    message.textContent = text;

    const time = document.createElement('span');
    time.className = 'message__time';
    time.textContent = formatTime(date);
    message.appendChild(time);

    if (trace) message.appendChild(buildTrace(trace));

    chatWindow.appendChild(message);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    return message;
}

// Загрузка сохранённых сообщений с сервера
async function loadMessages() {
    try {
        const res = await fetch('/api/messages');
        const messages = await res.json();
        messages.forEach((m) => addMessage(m.text, m.role === 'assistant' ? 'in' : 'out', new Date(m.createdAt), m.trace));
    } catch (err) {
        console.error('Не удалось загрузить сообщения', err);
    }
}

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    addMessage(text, 'out');
    input.value = '';
    sendButton.disabled = true;
    const typing = addMessage('Агент думает…', 'in');

    try {
        const res = await fetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, model: currentModel }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        typing.remove();
        addMessage(data.reply.text, 'in', new Date(data.reply.createdAt), data.reply.trace);
    } catch (err) {
        typing.remove();
        addMessage('Ошибка: ' + err.message, 'in');
    } finally {
        sendButton.disabled = false;
        input.focus();
    }
});

loadMessages();

// Enter — отправить, Shift+Enter — новая строка
input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
    }
});

// ---------- Монитор: что происходит с моделью прямо сейчас ----------
const monitorLog = document.getElementById('monitorLog');
const monitorStatus = document.getElementById('monitorStatus');
const monitorClear = document.getElementById('monitorClear');
const MONITOR_LIMIT = 300; // сколько строк держать в панели

function short(value, limit = 160) {
    const text = JSON.stringify(value);
    return text.length > limit ? text.slice(0, limit) + '…' : text;
}

function monitorLine(text, kind) {
    const row = document.createElement('div');
    row.className = `monitor__line monitor__line--${kind}`;
    row.textContent = `${new Date().toLocaleTimeString('ru-RU')}  ${text}`;

    monitorLog.appendChild(row);
    while (monitorLog.children.length > MONITOR_LIMIT) monitorLog.firstChild.remove();
    monitorLog.scrollTop = monitorLog.scrollHeight;
}

// Событие сервера -> строка на экране
function describeEvent(e) {
    switch (e.type) {
        case 'start':      return [`Вопрос к ${e.model || 'модели'}: ${e.question}`, 'start'];
        case 'thinking':   return [`Шаг ${e.step}: модель думает…`, 'wait'];
        case 'llm':        return [`Шаг ${e.step}: ответ модели за ${e.ms} мс — ` + (e.toolCalls.length ? `нужны инструменты: ${e.toolCalls.join(', ')}` : 'готов финальный ответ'), 'llm'];
        case 'tool-start': return [`Шаг ${e.step}: запускаю ${e.name}(${short(e.args, 80)})`, 'tool'];
        case 'tool':       return [`Шаг ${e.step}: ${e.name} вернул ${short(e.result)} за ${e.ms} мс`, 'tool'];
        case 'check':      return [`Шаг ${e.step}: проверка — ` + (e.passed ? 'пройдена' : `нарушено: ${e.failed.join(', ')}`), e.passed ? 'ok' : 'warn'];
        case 'retry':      return [`Шаг ${e.step}: отправляю на переделку (${e.reasons.join(', ')})`, 'warn'];
        case 'limit':      return [`Достигнут предел в ${e.steps} шагов`, 'warn'];
        case 'done':       return [`Готово за ${(e.totalMs / 1000).toFixed(1)} с`, 'done'];
        case 'error':      return [`Ошибка: ${e.message}`, 'error'];
        default:           return [short(e), 'llm'];
    }
}

const events = new EventSource('/api/events');

events.onopen = () => {
    monitorStatus.textContent = 'на связи';
    monitorStatus.className = 'monitor__status monitor__status--on';
};

events.onerror = () => {
    monitorStatus.textContent = 'нет связи';
    monitorStatus.className = 'monitor__status';
};

events.onmessage = (m) => {
    const [text, kind] = describeEvent(JSON.parse(m.data));
    monitorLine(text, kind);
};

monitorClear.addEventListener('click', () => {
    monitorLog.textContent = '';
});
// ---------- Выбор модели ----------
const modelSelect = document.getElementById('modelSelect');
const MODEL_KEY = 'polygon.model';

function readSavedModel() {
    try {
        return localStorage.getItem(MODEL_KEY);
    } catch {
        return null; // приватный режим или запрет на хранение
    }
}

let currentModel = readSavedModel();

async function loadModels() {
    try {
        const res = await fetch('/api/models');
        const data = await res.json();

        modelSelect.innerHTML = '';
        data.models.forEach((m) => {
            const option = document.createElement('option');
            option.value = m.id;
            option.textContent = m.installed ? m.title : `${m.title} — не скачана`;
            option.title = m.note || '';
            modelSelect.appendChild(option);
        });

        // Сохранённый выбор мог устареть — тогда берём модель по умолчанию
        const known = data.models.some((m) => m.id === currentModel);
        currentModel = known ? currentModel : data.defaultModel;
        modelSelect.value = currentModel;
    } catch (err) {
        console.error('Не удалось получить список моделей', err);
    }
}

modelSelect.addEventListener('change', () => {
    currentModel = modelSelect.value;
    try {
        localStorage.setItem(MODEL_KEY, currentModel);
    } catch {
        // не смогли запомнить — не страшно
    }
    monitorLine(`Выбрана модель ${currentModel}`, 'start');
});

loadModels();
