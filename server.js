const express = require('express');
const cookieParser = require('cookie-parser');
const http = require('http');
const WebSocket = require('ws');
const { MongoClient } = require('mongodb');
const bodyParser = require('body-parser')
const dbFunc = require(`./dbFunc.js`)
const cors = require('cors');
const path = require('path');
const routes = require('./routes/routes.js');
const {logger} = require('./helper/Logger.js');
const jwt = require(`jsonwebtoken`)
const { msgHandler } = require('./routes/websocket-routes.js');
require('dotenv').config()

const secretKey = process.env.JWT_SECRET_KEY
let mongoClient;
let db;

// Создаем сервер Express и WebSocket
const app = express();
app.use(cookieParser())
app.use(bodyParser.json());//
app.use(cors());
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

//проверка доступа по роли
const checkAccess = (action, role) => accessControl[action]?.includes(role) || false;

// подключение к монго ДБ
async function startMongoConnection() {
  try {
    mongoClient = new MongoClient(process.env.MONGO_URL, {  });
    await mongoClient.connect();
    db = mongoClient.db('RegAD');
    logger.info('MongoDB подключен с использованием пула соединений');
    console.log(`${getDateNow()} | Подключено к MongoDB`);
  } catch (error) {
    logger.error(`Ошибка подключения к MongoDB: ${error}`);
    process.exit(1); // Завершаем процесс при ошибке подключения
  }
}

async function start() {
  try {
    // Подключение к MongoDB
    await startMongoConnection()
    
    // Запуск отслеживания изменений в MongoDB через Change Streams
    const changeStream = db.watch([], { fullDocument: 'updateLookup' });

    // Когда происходит изменение в коллекции
    changeStream.on('change', async (change) => {
      //получаем всю коллекцию с обьеденением данных (populate)
      const updateCollection = await dbFunc.getCollectionMongoose({collection: change.ns.coll !== 'ADTool' ? change.ns.coll : undefined})      
      if (updateCollection.error) { // Проверка на существование коллекции
        logger.warn(`Коллекция не найдена: ${change.ns.coll}`)
        return; // Возвращаем, чтобы избежать ошибок
      }         
      const filteredCollection = updateCollection?.find(row => row._id?.equals(change.documentKey._id));
      logger.info(`Изменение (${change.operationType}) в базе данных: коллекция - ${change.ns.coll} | ID - ${change.documentKey._id}`)
      
      // Отправка изменений всем подключенным клиентам
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(
            {type:change.operationType, collection:change.ns.coll, id:change.documentKey._id, full:filteredCollection, client: client._socket.remoteAddress}
          ));
        }
      });
    });

    changeStream.on("end", () => {
      console.error(`${getDateNow()} | Change Stream END:`);
      logger.error(`Change Stream END:`)
    });
    changeStream.on("error", (error) => {
        console.error(`${getDateNow()} | Change Stream error:`, error);
        logger.error(`Change Stream error: ${error}`)
    });

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

    // Обработка подключений WebSocket, обработка одного клиента
    wss.on('connection', async (ws,req) => {
      //работа с токенами
      const url = new URL(req.url, `http://${req.headers.host}`);
      const token = url.searchParams.get('token');  
      
      if (!token) {
        ws.close(); // Закрываем соединение, если токен отсутствует
        logger.warn(`Подключение отклонено: токена не существует (пользователь не найден).`)
        return;
      }
            
      try {    
        const clientIP = req.socket.remoteAddress
        logger.info(`Клиент подключен (${wss.clients.size}-й) IP-адрес: ${clientIP}`)
        let userRole;
        let decoded;
        //декодирование токена, получение роли , и обработка окончания действия токена
        try {
          decoded = jwt.verify(token, secretKey);
          userRole = decoded.role
          const expirationDate = new Date(decoded.exp * 1000).toString();
          console.log(`${getDateNow()} | Пользователь аутентифицирован: ${decoded.username} (истекает: ${expirationDate}), роль: ${userRole} ${new Date(decoded.exp*1000).toString()}`);
          logger.info(`Пользователь аутентифицирован: ${decoded.username} (истекает: ${expirationDate}), роль: ${userRole} ${new Date(decoded.exp*1000).toString()}`)
        } catch (err) {
          if (err.name === 'TokenExpiredError') {
            logger.warn(`Токен истек ${decoded.username}`);
            ws.send(JSON.stringify({ error: 'Токен истек. Пожалуйста, авторизуйтесь заново.', cmd:'logout' }));
          } else {
            logger.warn(`Ошибка аутентификации: ${err.message}`);
          }
          ws.close();
          return;
        }    

        ws.on('error', (err) =>{
          console.log(`${getDateNow()} | Ошибка при работе с клиентом: ${err}`);
          logger.error(`Ошибка при работе с клиентом: ${err}`)
        })
       
        //сообщение от клиента
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
          catch {
            logger.error(`Ошибка при обработке сообщения от клиента: ${err.message}`);
            ws.send(JSON.stringify({ error: 'Ошибка при обработке сообщения.' }));
          }
          
        });

        //при отключении клиента
        ws.on('close', () => {
          console.log(`${getDateNow()} | Клиент отключен: `+wss.clients.size);
          logger.info(`Клиент отключен: ${wss.clients.size}`)
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
  }
}

start();
