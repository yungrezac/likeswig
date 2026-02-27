const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
// Railway автоматически назначает порт через переменные окружения
const PORT = process.env.PORT || 3000;

// Разрешаем запросы
app.use(cors());

// Раздаем статические файлы из текущей папки (чтобы отдавать HTML виджета)
app.use(express.static(__dirname));

// Простой кэш
const cache = {
    data: {},
    lastFetch: {}
};

// API маршрут
app.get('/api/followers/:username', async (req, res) => {
    const username = req.params.username;
    const now = Date.now();

    // Кэширование на 10 секунд (в Railway лучше сделать кэш чуть больше)
    if (cache.data[username] && (now - cache.lastFetch[username] < 10000)) {
        return res.json({ followers: cache.data[username], cached: true });
    }

    try {
        const response = await axios.get(`https://www.tiktok.com/@${username}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            },
            timeout: 5000
        });

        const match = response.data.match(/"followerCount":(\d+)/);
        
        if (match && match[1]) {
            const followers = parseInt(match[1], 10);
            cache.data[username] = followers;
            cache.lastFetch[username] = now;
            return res.json({ followers: followers });
        }

        res.status(404).json({ error: 'Не удалось найти количество подписчиков.' });

    } catch (error) {
        console.error(`[Ошибка] Не удалось получить данные для @${username}:`, error.message);
        res.status(500).json({ error: 'Ошибка при обращении к TikTok.' });
    }
});

// Главная страница отдает сам виджет
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'tiktok_widget.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту: ${PORT}`);
});
