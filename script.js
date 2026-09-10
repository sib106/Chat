const form = document.getElementById('chatForm');
const input = document.getElementById('messageInput');
const chatWindow = document.getElementById('chatWindow');

function formatTime(date) {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function addMessage(text, type) {
    const message = document.createElement('div');
    message.className = `message message--${type}`;
    message.textContent = text;

    const time = document.createElement('span');
    time.className = 'message__time';
    time.textContent = formatTime(new Date());
    message.appendChild(time);

    chatWindow.appendChild(message);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    addMessage(text, 'out');
    input.value = '';
    input.focus();
});

// Enter — отправить, Shift+Enter — новая строка
input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
    }
});
