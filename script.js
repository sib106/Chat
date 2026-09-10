const form = document.getElementById('chatForm');
const input = document.getElementById('messageInput');
const chatWindow = document.getElementById('chatWindow');

function formatTime(date) {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function addMessage(text, type, date = new Date()) {
    const message = document.createElement('div');
    message.className = `message message--${type}`;
    message.textContent = text;

    const time = document.createElement('span');
    time.className = 'message__time';
    time.textContent = formatTime(date);
    message.appendChild(time);

    chatWindow.appendChild(message);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

// Загрузка сохранённых сообщений с сервера
async function loadMessages() {
    try {
        const res = await fetch('/api/messages');
        const messages = await res.json();
        messages.forEach((m) => addMessage(m.text, 'out', new Date(m.createdAt)));
    } catch (err) {
        console.error('Не удалось загрузить сообщения', err);
    }
}

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    try {
        const res = await fetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        addMessage(data.text, 'out', new Date(data.createdAt));
        input.value = '';
        input.focus();
    } catch (err) {
        alert('Ошибка отправки: ' + err.message);
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
