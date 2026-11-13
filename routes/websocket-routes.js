const WebSocket = require('ws');
const dbFunc = require('../dbService.js');

const { logger } = require('../helper/Logger.js');

// коллекции, запись в которые разрешена только роли admin
const ADMIN_ONLY_COLLECTIONS = ['Users', 'Access'];

// безопасная отправка JSON: не падаем, если сокет уже закрыт
function sendJson(ws, payload) {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  } catch (err) {
    logger.error(`Ошибка отправки сообщения клиенту: ${err.message}`);
  }
}

const getAllClientIP = (wss) => Array.from(wss.clients)
    .filter(client => client.readyState === WebSocket.OPEN)
    .map(client => client._socket?.remoteAddress);

const msgHandler = {
  getCollectionMongoose: async (ws, messageData) => {
    try {
      const dataCollection = await dbFunc.getCollectionMongoose(messageData)
      if (dataCollection.error) {
        logger.warn(`Ошибка получения коллекции: ${dataCollection.logErr || dataCollection.error}`)
        sendJson(ws, { error: dataCollection.error });
      } else {
        sendJson(ws, {type:`getCollectionMongoose`, data:dataCollection, collection:messageData.collection});
      }
    }
    catch(err) {
      logger.error(`Ошибка при выполнении запроса (getCollMongoose)\n ${err}`)
      sendJson(ws, { error: 'Ошибка при получении коллекции на сервере.' });
    }
  },

  insertInToCollection: async (ws, messageData) => {
    try {
      const resInsert = await dbFunc.insertInToCollection(messageData)
      if (resInsert.error) {
        sendJson(ws, { error: resInsert.error });
        logger.warn(`Ошибка при добавлении данных: ${resInsert.logErr || resInsert.error}`)
      } else {
        // подтверждение клиенту; данные придут через change stream (broadcast)
        sendJson(ws, { type: 'ack', action: 'insertInToCollection', collection: messageData.collection, inserted: resInsert.inserted });
      }
    }
    catch (err) {
      logger.error(`Ошибка при выполнении запроса (insert)\n ${err}`)
      sendJson(ws, { error: 'Ошибка при попытке добавления на сервере.' });
    }
  },

  updateInCollection: async (ws, messageData) => {
    try {
        const updatedDocument = await dbFunc.updateInCollection(messageData);
        if (updatedDocument.error) {
            sendJson(ws, { error: updatedDocument.error });
            logger.warn(`Ошибка при обновлении данных: ${updatedDocument?.logErr || updatedDocument.error}`)
        } else {
            // данные об изменении разойдутся через change stream; ack подтверждает приём
            sendJson(ws, { type: 'ack', action: 'updateInCollection', collection: messageData.collection });
        }
    } catch (err) {
      logger.error(`Ошибка при выполнении запроса (update)\n ${err}`)
      sendJson(ws, { error: 'Ошибка при попытке обновления на сервере.' });
    }
  },

  deleteFromCollection: async (ws, messageData) => {
    try {
      const resDelete = await dbFunc.deleteFromCollection(messageData)
      if (resDelete.error){
        sendJson(ws, { error: resDelete.error });
        logger.warn(`Ошибка при удалении данных: ${resDelete?.logErr || resDelete.error}`)
      } else {
        sendJson(ws, { message: resDelete });
      }
    }
    catch (err) {
      logger.error(`Ошибка при выполнении запроса (delete)\n ${err}`)
      sendJson(ws, { error: 'Ошибка при попытке удаления на сервере.' });
    }
  },

  getAllClientsIp: async (ws, messageData, wss) => {
    try {
      const clientIP = getAllClientIP(wss)
      if (!clientIP.length) {
        sendJson(ws, { error: 'Нет активных подключений.' });
        logger.warn('Список IP клиентов пуст.')
      } else {
        sendJson(ws, {clients: clientIP});
      }
    }
    catch (err) {
      logger.error(`Ошибка при выполнении запроса (getAllClientsIp)\n ${err}`)
      sendJson(ws, { error: 'Ошибка при выполнении задачи получения айпи клиентов на сервере.' });
    }
  },

  quitClientConnect: async (ws, messageData, wss) => {
    try {
      const targetIp = messageData?.targetIp
      if (!targetIp) {
        sendJson(ws, { error: 'Не указан IP для отключения (targetIp).' });
        return;
      }
      let found = false;
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client._socket?.remoteAddress === targetIp) {
          found = true;
          sendJson(client, {
            type: 'quit',
            message: true,
          });
        }
      });
      if (!found) {
        sendJson(ws, { error: `Клиент с IP ${targetIp} не найден среди подключений.` });
        logger.warn(`Клиент для отключения не найден: ${targetIp}`)
      }
    }
    catch (err) {
      logger.error(`Ошибка при выполнении запроса (quitClientConnect)\n ${err}`)
    }
  },

  default: (ws) => {
    sendJson(ws, { error: 'Метод для работы не найден' });
    logger.error('Метод для работы не найден')
  }
};

// проверка, что запись в коллекцию разрешена данной роли
function checkCollectionAccess(actionType, role, messageData) {
  if (!['insertInToCollection', 'updateInCollection', 'deleteFromCollection'].includes(actionType)) {
    return true;
  }
  const collection = messageData?.collection;
  if (ADMIN_ONLY_COLLECTIONS.includes(collection) && role !== 'admin') {
    return false;
  }
  return true;
}

module.exports = { msgHandler, checkCollectionAccess, sendJson };
