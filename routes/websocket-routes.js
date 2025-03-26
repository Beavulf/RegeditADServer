const WebSocket = require('ws');
const dbFunc = require('../dbFunc.js');

const { logger } = require('../helper/Logger.js');

const getAllClientIP = (wss) => Array.from(wss.clients)
    .filter(client => client.readyState === WebSocket.OPEN)
    .map(client => client._socket.remoteAddress);

const msgHandler = {
  getCollectionMongoose: async (ws, messageData) => {
    try {
      const dataCollection = await dbFunc.getCollectionMongoose(messageData)
      if (dataCollection.error) {
        logger.warn(`Коллекция не найдена: ${dataCollection.logErr}`)
        ws.send(JSON.stringify({ error: 'Коллекция не найдена' }));
      } else {
        ws.send(JSON.stringify({type:`getCollectionMongoose`, data:dataCollection, collection:messageData.collection}));
      }
    }
    catch(err) {
      logger.error(`Ошибка при выполнении 3апроса (getCollMongoose)\n ${err}`)
      ws.send(JSON.stringify({ error: `Ошибка при получении коллекции ${err}` }));
    }    
  },

  insertInToCollection: async (ws, messageData, db)=>{
    try {
      const resInsert = await dbFunc.insertInToCollection(messageData,db)
      if (resInsert.error) {
        ws.send(JSON.stringify({ error: `Ошибка при добавлении данных: ${resInsert.error}` }));
        logger.warn(`Ошибка при добавлении данных: ${resInsert.logErr}`)
      }
    }
    catch (err) {
      logger.error(`Ошибка при выполнении запроса (insert)\n ${err}`)
      ws.send(JSON.stringify({ error: `Ошибка при попытке добавления: ${err}` }));
    }
  },

  updateInCollection: async (ws, messageData, db) => {
    try {
        const updatedDocument = await dbFunc.updateInCollection(messageData, db);
        if (updatedDocument.error) {
            ws.send(JSON.stringify({ error: `Ошибка при обновлении данных, код ошибки - ${updatedDocument.error}` }));
            logger.warn(`Ошибка при обновлении данных: ${updatedDocument?.logErr}`)
        }
    } catch (err) {
      logger.warn(`Ошибка при выполнении запроса (update)\n ${err}`)
      ws.send(JSON.stringify({ error: `Ошибка при попытке обновления. (${err})` }));
    }
  },

  deleteFromCollection: async (ws, messageData, db) => {
    try {
      const resDelete = await dbFunc.deleteFromCollection(messageData,db)
      if (resDelete.error){
        ws.send(JSON.stringify({ error: `Ошибка при удалении данных, код ошибки - ${resDelete.error}` }));
        logger.warn(`Ошибка при удалении данных: ${resDelete?.logErr}`)
      } else {
        ws.send(JSON.stringify({ message: resDelete }));
      }
    }
    catch (err) {
      logger.error(`Ошибка при выполнении запроса (delete)\n ${err}`)
      ws.send(JSON.stringify({ error: `Ошибка при попытке удаления. (${err})` }));
    }   
  },

  getAllClientsIp: async (ws, messageData, db, wss) => {
    try {
      const clientIP = getAllClientIP(wss)
      if (!clientIP) {
        ws.send(JSON.stringify({ error: 'Ошибка при получение списка айпи.' }));
        logger.warn(`Ошибка при получение списка айпи.`)
      } else {
        ws.send(JSON.stringify({clients: clientIP}));
      }
    }
    catch (err) {
      logger.error(`Ошибка при выполнении запроса (delete)\n ${err}`)
      ws.send(JSON.stringify({ error: 'Ошибка при выполнении задачи получения айпи клиентов на сервере.' }));
    }   
  },

  quitClientConnect: async (ws, messageData, db, wss) => {
    try {
      const targetIp = messageData.targetIp
      wss.clients.forEach((client) => {    
        if (client.readyState === WebSocket.OPEN && client._socket.remoteAddress === targetIp) {
          client.send(JSON.stringify({
            type: 'quit',
            message: true,
          }));
          return true;
        }
      });
      return false;
    }
    catch (err) {
      logger.error(`Ошибка при выполнении запроса (quitClientConnect)\n ${err}`)
    }
  },

  default: (ws) => {
    ws.send(JSON.stringify({ error: 'Метод для работы не найден' }));
    logger.error(`Метод для работы не найден`)
  }
};

module.exports = { msgHandler };