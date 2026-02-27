const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
// Railway автоматически назначает порт через переменные окружения
const PORT = process.env.PORT || 3000;

// Разрешаем CORS запросы
app.use(cors());

// Раздаем статические файлы (чтобы отдавать HTML виджета)
app.use(express.static(__dirname));

// Простой кэш (чтобы не спамить API и не получить бан IP)
const cache = {
    data: {},
    lastFetch: {}
};

// API маршрут
app.get('/api/followers/:username', async (req, res) => {
    const username = req.params.username;
    const now = Date.now();

    // Кэширование на 10 секунд
    if (cache.data[username] && (now - cache.lastFetch[username] < 10000)) {
        return res.json({ followers: cache.data[username], cached: true });
    }

    try {
        // СПОСОБ 1: Используем специализированный открытый API для виджетов (TokCount)
        // Он специально создан для обхода блокировок TikTok
        const response = await axios.get(`https://api.tokcount.com/?type=userinfo&username=${username}`, {
            timeout: 6000
        });

        if (response.data && response.data.followerCount !== undefined) {
            const followers = parseInt(response.data.followerCount, 10);
            cache.data[username] = followers;
            cache.lastFetch[username] = now;
            return res.json({ followers: followers });
        }
        
        throw new Error("TokCount API не вернул данные");

    } catch (error) {
        console.log(`[Способ 1 не удался] Пробуем парсинг страницы для @${username}...`);
        
        try {
            // СПОСОБ 2: Парсинг официальной страницы TikTok (резервный метод)
            // Добавляем продвинутые заголовки, чтобы притвориться реальным браузером
            const fallbackResponse = await axios.get(`https://www.tiktok.com/@${username}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Cache-Control': 'no-cache'
                },
                timeout: 6000
            });

            // Ищем количество подписчиков (TikTok часто меняет формат, поэтому используем несколько проверок)
            const regexes = [
                /"followerCount":\s*(\d+)/,
                /"followerCount":\s*"(\d+)"/,
                /"fans":\s*(\d+)/
            ];

            let followers = null;
            for (let regex of regexes) {
                const match = fallbackResponse.data.match(regex);
                if (match && match[1]) {
                    followers = parseInt(match[1], 10);
                    break;
                }
            }

            if (followers !== null) {
                cache.data[username] = followers;
                cache.lastFetch[username] = now;
                return res.json({ followers: followers });
            } else {
                return res.status(404).json({ error: 'Не удалось найти количество подписчиков. Возможно, TikTok выдал капчу Railway-серверу.' });
            }

        } catch (fallbackError) {
            console.error(`[Ошибка резервного метода]:`, fallbackError.message);
            res.status(500).json({ error: 'Ошибка при обращении к TikTok. Сервер заблокирован.' });
        }
    }
});

// Главная страница отдает сам виджет
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'tiktok_widget.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту: ${PORT}`);
});
