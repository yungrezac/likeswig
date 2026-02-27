const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector'); // Библиотека для Live API

const app = express();
const server = http.createServer(app); // Используем http для поддержки WebSockets
const io = new Server(server, {
    cors: { origin: "*" }
});

// Railway автоматически назначает порт через переменные окружения
const PORT = process.env.PORT || 3000;

// Разрешаем CORS запросы
app.use(cors());

// Раздаем статические файлы (чтобы отдавать HTML виджета)
app.use(express.static(__dirname));

// Простой кэш (чтобы не спамить API)
const cache = {
    data: {},
    lastFetch: {}
};

// Храним активные подключения к стримам, чтобы не дублировать
const activeLiveConnections = {};

// --- SOCKET.IO: Соединение с виджетом OBS в реальном времени ---
io.on('connection', (socket) => {
    console.log('🟢 Виджет подключился к серверу');

    socket.on('set_username', (username) => {
        // Если уже слушаем этот стрим, пропускаем
        if (activeLiveConnections[username]) {
            console.log(`[Live] Уже слушаем стрим @${username}`);
            return;
        }

        console.log(`[Live] Попытка подключения к стриму @${username}...`);
        
        // Создаем подключение к Live трансляции
        let tiktokLiveConnection = new WebcastPushConnection(username);

        tiktokLiveConnection.connect().then(state => {
            console.info(`[Live] ✅ Успешно подключено к стриму @${username}!`);
            activeLiveConnections[username] = tiktokLiveConnection;
        }).catch(err => {
            console.error(`[Live] ❌ Ошибка: стрим оффлайн или не найден.`, err.toString());
        });

        // 🎯 ГЛАВНОЕ СОБЫТИЕ: Новый подписчик во время стрима
        tiktokLiveConnection.on('follow', (data) => {
            console.log(`[Live] 🔔 НОВЫЙ ПОДПИСЧИК: ${data.nickname} (@${data.uniqueId})`);
            
            // Моментально отправляем реальную аву и ник в виджет
            io.emit('new_subscriber_live', {
                nickname: data.nickname,
                avatar: data.profilePictureUrl
            });
        });

        // Очистка при завершении стрима
        tiktokLiveConnection.on('streamEnd', () => {
            console.log(`[Live] 🛑 Стрим @${username} завершен.`);
            delete activeLiveConnections[username];
        });
        
        tiktokLiveConnection.on('disconnected', () => {
            console.log(`[Live] 🔌 Отключено от стрима @${username}.`);
            delete activeLiveConnections[username];
        });
    });
});

// --- HTTP API: Оставляем для общего количества подписчиков ---
app.get('/api/followers/:username', async (req, res) => {
    const username = req.params.username;
    const now = Date.now();

    // Кэширование на 10 секунд
    if (cache.data[username] && (now - cache.lastFetch[username] < 10000)) {
        return res.json({ followers: cache.data[username], cached: true });
    }

    try {
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
        try {
            const fallbackResponse = await axios.get(`https://www.tiktok.com/@${username}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Cache-Control': 'no-cache'
                },
                timeout: 6000
            });

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
                return res.status(404).json({ error: 'Не удалось найти количество подписчиков.' });
            }

        } catch (fallbackError) {
            res.status(500).json({ error: 'Ошибка при обращении к TikTok.' });
        }
    }
});

// Главная страница отдает сам виджет
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'tiktok_widget.html'));
});

// Запускаем через server.listen (чтобы работали сокеты)
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту: ${PORT}`);
});
