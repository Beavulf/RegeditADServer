// Node built-in modules
const http = require('http');
const path = require('path');
const { exec } = require('child_process');

// Third-party modules
const express = require('express');
const WebSocket = require('ws');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient } = require('mongodb');

// Local modules
const routes = require('./routes/routes.js');
const dbFunc = require('./dbService.js');
const { logger } = require('./helper/Logger.js');
const { msgHandler } = require('./routes/websocket-routes.js');
const { log } = require('console');

require('dotenv').config();

// проверка на наличие переменных окружения
['PORT', 'JWT_SECRET_KEY', 'MONGO_URL', 'MONGO_DB_CONNECTION_URL', 'CORS_DOMAINS'].forEach((key) => {
  if (!process.env[key]) throw new Error(`Не задана переменная окружения: ${key}`);
});

const secretKey = process.env.JWT_SECRET_KEY
let mongoClient;
let db;
let changeStream;

// Создаем сервер Express и WebSocket
const app = express();
app.use(cookieParser())
app.use(bodyParser.json());
app.use(cors({credentials:true, origin:process.env.CORS_DOMAINS.split(',')}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use('/', routes);

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });  // WebSocket-сервер

//получение текущего времени
function getDateNow() {
  return new Date().toLocaleString();
}

//распределение ролей на 3адачи
const accessControl = {
  insertInToCollection: ['admin', 'manager'],      
  updateInCollection: ['admin', 'manager'],        
  deleteFromCollection: ['admin', 'manager'], 
  getAllClientsIp: [`admin`, `manager`],
  getCollectionMongoose: [`admin`, `manager`],
  quitClientConnect: ['admin', 'manager'],
};

//отправка сообщения всем клиентам
const broadcastMessage = (message) => {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

//проверка доступа к методу по роли
const checkAccess = (action, role) => accessControl[action]?.includes(role) || false;

//перезапуск сервиса MongoDB
function restartMongoService() {
  exec('powershell.exe Restart-Service -Name "MongoDB"', (error, stdout, stderr) => {
    if (error) {
      console.error(`${getDateNow()} | Ошибка при попытке перезапуска MongoDB: ${error.message}`);
      logger.error(`Ошибка при попытке перезапуска MongoDB: ${error.message}`);
      broadcastMessage({ error: 'Не удалось перезапустить MongoDB. Обратитесь к администратору.' });
      return;
    }
    logger.info('Служба MongoDB перезапущена');
    console.log(`${getDateNow()} | Служба MongoDB была перезапущена. Попробуйте переподключиться.`);
    broadcastMessage({ warning: 'Служба MongoDB была перезапущена. Попробуйте переподключиться.' });
  });
}

// подключение к монго ДБ
async function startMongoConnection() {
  try {
    mongoClient = new MongoClient(process.env.MONGO_URL, {  });
    await mongoClient.connect();
    db = mongoClient.db('RegAD');
    logger.info('MongoDB подключен с использованием пула соединений');
    console.log(`${getDateNow()} | Подключено к MongoDB`);
  } catch (error) {
    console.error(`${getDateNow()} | Ошибка подключения к MongoDB: ${error}`);
    logger.error(`Ошибка подключения к MongoDB: ${error}`);
    process.exit(1); // Завершаем процесс при ошибке подключения
  }
}

//запуск change stream
function startChangeStream() {
  if (changeStream) {
    changeStream.removeAllListeners();
    try { changeStream.close(); } catch {}
  }
  changeStream = db.watch([], { fullDocument: 'updateLookup' });

  changeStream.on('change', async (change) => {
    try {
      if (change.ns.coll === 'ADTool') return;
      const updateCollection = await dbFunc.getCollectionMongoose({collection: change.ns.coll})
      if (updateCollection.error) {
        logger.warn(`Коллекция не найдена: ${change.ns.coll}`)
        return;
      }
      const filteredCollection = updateCollection?.find(row => row._id?.equals(change.documentKey._id));
      logger.info(`Изменение (${change.operationType}) в базе данных: коллекция - ${change.ns.coll} | ID - ${change.documentKey._id}`)
      broadcastMessage({type:change.operationType, collection:change.ns.coll, id:change.documentKey._id, full:filteredCollection});
    } catch (err) {
      logger.error(`Ошибка при обработке изменения в базе данных: ${err}`);
      broadcastMessage({error: `Ошибка при обработке изменения в базе данных: ${err}`})
    }
  });

  changeStream.on('end', () => {
    logger.error('Change Stream END');
  });

  changeStream.on('error', (error) => {
    logger.error(`Change Stream error: ${error}`);
    console.error(`${getDateNow()} | Change Stream error: ${error}`);
    broadcastMessage({ error: 'Потеряно соединение с MongoDB. Попытка перезапуска...' });
    restartMongoAndReconnect();
  });
}

//перезапуск MongoDB и change stream
async function restartMongoAndReconnect() {
  restartMongoService();
  setTimeout(async () => {
    try {
      if (mongoClient) {
        try { await mongoClient.close(); } catch {}
      }
      await startMongoConnection();
      startChangeStream();
      logger.info('Change stream успешно перезапущен после рестарта MongoDB');
      broadcastMessage({ warning: 'Соединение с MongoDB восстановлено, change stream перезапущен.' });
    } catch (err) {
      logger.error('Ошибка переподключения к MongoDB после рестарта: ' + err);
      setTimeout(restartMongoAndReconnect, 5000);
    }
  }, 5000);
}

async function start() {
  try {
    await startMongoConnection();
    startChangeStream();
    
    process.on('SIGINT', async () => {
      try {
        await changeStream.close();
        await mongoClient.close();
        wss.close();
        process.exit(0);
      } catch (err) {
        logger.error(`Ошибка при остановке сервера: ${err}`);
      }
    });
    process.on('uncaughtException', async (err) => {
      logger.error(`Необработанная ошибка: ${err}`);
      await mongoClient.close();
      wss.close();
      process.exit(1);
    });
    process.on('SIGTERM', async () => {
      await changeStream.close();
      await mongoClient.close();
      wss.close();
      process.exit(0);
    });
    // Обработка подключений WebSocket, обработка одного клиента
    wss.on('connection', async (ws,req) => {
      //работа с токенами      
      // const url = new URL(req.url, `http://${req.headers.host}`);
      // const token = url.searchParams.get('token');  
      let token;
      // Получаем cookies из заголовка
      const cookies = req.headers?.cookie;
      if (cookies) {
        const cookiesArray = cookies.split(';');
        const tokenCookie = cookiesArray.find(cookie => cookie.trim().startsWith('token='));
        if (tokenCookie) {
          token = tokenCookie.split('=')[1].trim();
        }
      }
      // Закрываем соединение, если токен отсутствует
      if (!token) {
        ws.close(); 
        logger.warn(`Подключение отклонено: токена не существует (пользователь не найден).`)
        return;
      }
            
      // елси токен есть
      try {    
        const clientIP = req.socket.remoteAddress
        logger.info(`Клиент подключен (${wss.clients.size}-й) IP-адрес: ${clientIP}`)
        let userRole;
        let decoded;
        
        // Функция проверки токена
        const checkToken = () => {
          try {
            decoded = jwt.verify(token, secretKey);
            return true;
          } catch (err) {
            if (err.name === 'TokenExpiredError') {
              logger.warn(`Токен истек для пользователя ${decoded?.username || 'неизвестный'}`);
              ws.send(JSON.stringify({ 
                error: 'Токен истек, пожалуйста, авторизуйтесь заново.', 
                cmd: 'logout' 
              }));
              setTimeout(() => {
                ws.close();
              }, 2000);
            }
            return false;
          }
        };

        // Установка интервала проверки токена каждую минуту
        const tokenCheckInterval = setInterval(() => {
          if (!checkToken()) {
            clearInterval(tokenCheckInterval);
          }
        }, 60000); // Проверка каждую минуту

        // При закрытии соединения очищаем интервал
        ws.on('close', () => {
          clearInterval(tokenCheckInterval);
          console.log(`${getDateNow()} | Клиент отключен: `+wss.clients.size);
          logger.info(`Клиент отключен: ${wss.clients.size}`);
        });

        // Начальная проверка токена
        if (!checkToken()) {
          return;
        }

        userRole = decoded.role
        const expirationDate = new Date(decoded.exp * 1000).toLocaleTimeString();
        console.log(`${getDateNow()} | Пользователь аутентифицирован: ${decoded.username} (сессия истекает: ${expirationDate}), роль: ${userRole}`);
        logger.info(`Пользователь аутентифицирован: ${decoded.username} (сессия истекает: ${expirationDate}), роль: ${userRole}`)

        ws.on('error', (err) =>{
          console.log(`${getDateNow()} | Ошибка при работе с клиентом: ${err}`);
          logger.error(`Ошибка при работе с клиентом: ${err}`)
        })
       
        //получение и обработка сообщения от клиента
        ws.on('message', async (message) => {
          try {
            const clientMessage = JSON.parse(message)
            const actionType = clientMessage.type;
            logger.info(`Сообщение от клиента: ${clientIP}`,clientMessage)
  
            // Автоматическая проверка прав доступа
            if (!checkAccess(actionType, userRole)) {
              logger.warn(`Попытка выполнения действия ${decoded.username} (${actionType}) под ролью ${userRole}`)
              ws.send(JSON.stringify({ error: 'Доступ запрещен: недостаточно прав для выполнения этого действия.' }));
              return;  // Прекращаем выполнение, если доступ запрещён
            }
            //выполнение методов по 3апросу
            if (msgHandler[actionType]) {
              await msgHandler[actionType](ws, clientMessage.data, db, wss);
            } else {
              msgHandler.default(ws, clientMessage.data);
            }
          }
          catch (err) {
            logger.error(`Ошибка при обработке сообщения от клиента: ${err.message}`);
            ws.send(JSON.stringify({ error: 'Ошибка при обработке сообщения.' }));
          }
          
        });
      }
      catch (err) {
        if (err.name === 'TokenExpiredError') {
          // Отправка сообщения об истечении токена клиенту
          ws.send(JSON.stringify({ error: 'Ваш токен истек. Пожалуйста, авторизуйтесь заново.' }));
    
          // Отключение клиента
          ws.terminate();
    
          console.log(`${getDateNow()} | Клиент отключен из-за истечения токена: ${req.socket.remoteAddress}`);
          logger.info(`Клиент отключен из-за истечения токена: ${req.socket.remoteAddress}`);
        } else {
          ws.close(); // Закрываем соединение, если токен неверен
          console.log(`${getDateNow()} | Ошибка аутентификации при попытке авторизации: `, err.message);
          logger.warn(`Ошибка аутентификации при попытке авторизации: ${err.message}`);
        }
      }
    });

    wss.on('error', (err) =>{
      console.log(`${getDateNow()} | Ошибка при подключение клиента: ${err}`);
      logger.error(`Ошибка при подключение клиента: ${err}`)
    })

    // Запуск веб-сервера на порту 3000
    server.listen(process.env.PORT, () => {
      logger.info(`Сервер запущен на http://localhost:${process.env.PORT}`)
    });

  } catch (error) {
    console.error(`${getDateNow()} | Ошибка при запуске сервера:`, error);
    logger.error(`Ошибка при запуске сервера: ${error}`)
    process.exit(1);
  }
}

start();
