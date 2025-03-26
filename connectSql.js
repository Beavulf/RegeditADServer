const sql = require('mssql');
const { MongoClient } = require('mongodb');
require('dotenv').config()
// const {logger} = require('./helper/Logger.js');

const sqlUser = process.env.SQL_USER
const sqlPass = process.env.SQL_PASSWORD
const sqlServer = process.env.SQL_SERVER
const sqlDatabase = process.env.SQL_DATABASE
let intervalToFetch;
// Конфигурация подключения к SQL Server
const config = {
  user: sqlUser,           
  password: sqlPass,
  server: sqlServer,
  database: sqlDatabase,  
  options: {
    encrypt: true,                
    trustServerCertificate: true   // для локальной разработки можно использовать true, на продакшене – установить по необходимости
  }
};

// получение данных из таблицы
async function getDataFromTable(table) {
  try {
    let pool = await sql.connect(config);
    let result = await pool.request().query(`SELECT * FROM ${table}`);
    return result
  } catch (err) {
    console.error('Ошибка при выполнении запроса:', err);
  } finally {
    await sql.close();
  }
}

// Переменная для хранения идентификатора интервала
let intervalId = null;
// получение из SQL, данных и перезапись их в mongodb
async function getAndRewriteArchiveData() {
  let pool = null;
  let mongoClient = null;
  
  try {
    // Подключение к SQL
    pool = await sql.connect(config);
    // logger.info(`Выполнение периодической задачи...`);
    
    // Получение данных
    let data = await pool.request().query('SELECT * FROM ArchiveUserToChange');
    const result = data.recordset;
    // logger.info(`Извлечено записей: ${result.length}`);
    
    // Подключение к MongoDB
    mongoClient = new MongoClient(process.env.MONGO_URL, {});
    await mongoClient.connect();
    const db = mongoClient.db('RegAD');
    const collection = db.collection('ADTool');
    
    // logger.info('Очистка коллекции в MongoDB...');
    await collection.deleteMany({});
    
    // logger.info('Вставка данных в MongoDB...');
    if (result.length > 0) {
      await collection.insertMany(result);
    }
    
    // logger.info('Синхронизация завершена успешно.');
    return {success: 'Синхронизация завершена успешно.'};
    
  } catch (err) {
    // logger.error('Ошибка при выполнении периодической задачи:', err);
    console.error('Ошибка при выполнении периодической задачи:', err);
    return {error: 'Ошибка синхронизации: ' + err.message};
  } finally {
    // Гарантированное закрытие соединений
    if (mongoClient) {
      try {
        await mongoClient.close();
        // logger.info('MongoDB соединение закрыто');
      } catch (err) {
        // logger.error('Ошибка при закрытии MongoDB соединения:', err);
      }
    }
    
    if (pool) {
      try {
        await sql.close();
        // logger.info('SQL соединение закрыто');
      } catch (err) {
        // logger.error('Ошибка при закрытии SQL соединения:', err);
      }
    }
  }
}

// Функция для запуска периодической задачи
async function startPeriodicTask(interval = 60000 * 60 * 3) { // По умолчанию каждый 3 часа
  if (intervalId) {
    intervalToFetch = interval
    // logger.warn('Периодическая задача уже запущена');
    return {warn:'Периодическая задача уже запущена'}
  }
  if (interval > 0) {
    intervalToFetch = interval
    intervalId = setInterval(getAndRewriteArchiveData, interval);
    // logger.info(`Периодическая задача запущена с интервалом ${interval / 60000 / 60} ч`);
    return {success:`Периодическая задача запущена с интервалом ${interval / 60000 / 60} ч`}
  }
  // logger.warn('Интервал периодической задачи не может быть отрицательным или равным нулю');
  return {warn:'Интервал периодической задачи не может быть отрицательным или равным нулю'}
}

// функция для остановки периодической задачи
function stopPeriodicTask() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    intervalToFetch = null
    // logger.info('Периодическая задача остановлена');
    return {success:'Периодическая задача остановлена'}
  } else {
    // logger.info('Периодическая задача не была запущена');
    return {error:'Периодическая задача не была запущена'}
  }
}

function getIntervalTime() {
  return intervalToFetch / 60000 / 60;
}

module.exports = {
    getDataFromTable,
    startPeriodicTask,
    stopPeriodicTask,
    getAndRewriteArchiveData,
    getIntervalTime
}