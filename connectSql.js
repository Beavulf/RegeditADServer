const sql = require('mssql');
const mongoose = require('mongoose');
require('dotenv').config()
const {logger} = require('./helper/Logger.js');

// whitelist таблиц, доступных для чтения из SQL (защита от SQL-инъекции через tableName)
const ALLOWED_TABLES = ['ArchiveUserToChange'];
// лимит строк, выгружаемых из SQL за одну синхронизацию
const SYNC_LIMIT = 10000;

// Конфигурация подключения к SQL Server
const config = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  server: process.env.SQL_SERVER,
  database: process.env.SQL_DATABASE,
  options: {
    encrypt: true,
    trustServerCertificate: true   // для локальной разработки можно использовать true, на продакшене – установить по необходимости
  }
};

// переиспользуемое подключение к SQL (глобальный пул mssql)
let poolPromise = null;
async function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect({
      ...config,
      connectionTimeout: 30000, // 30 секунд таймаут на подключение
      requestTimeout: 30000     // 30 секунд таймаут на запрос
    }).catch((err) => {
      poolPromise = null; // при ошибке разрешаем повторную попытку при следующем вызове
      throw err;
    });
  }
  return poolPromise;
}

// дескриптор MongoDB из общего подключения mongoose (ожидание готовности)
function getMongoDb() {
  const conn = mongoose.connection;
  if (conn.readyState !== 1) {
    throw new Error('MongoDB ещё не подключена, синхронизация невозможна.');
  }
  return conn.db;
}

// получение данных из таблицы (только из белого списка)
async function getDataFromTable(table) {
  if (!ALLOWED_TABLES.includes(table)) {
    throw new Error(`Таблица "${table}" недоступна для чтения.`);
  }
  const pool = await getPool();
  const result = await pool.request().query(`SELECT * FROM ${table}`);
  return result;
}

// получение из SQL, данных и перезапись их в mongodb
async function getAndRewriteArchiveData() {
  let tempCollectionName = null;

  try {
    // Получение данных с ограничением
    const pool = await getPool();
    let data = await pool.request().query(`SELECT TOP ${SYNC_LIMIT} * FROM ArchiveUserToChange`);
    const result = data.recordset;

    if (result.length === 0) {
      return { success: 'Нет данных для синхронизации' };
    }

    // Атомарная замена: заливаем во временную коллекцию и переименовываем,
    // чтобы у клиентов не было «окна» с пустой коллекцией
    const db = getMongoDb();
    tempCollectionName = `ADTool_sync_${Date.now()}`;
    const tempCollection = db.collection(tempCollectionName);

    const batchSize = 1000;
    for (let i = 0; i < result.length; i += batchSize) {
      await tempCollection.insertMany(result.slice(i, i + batchSize), { ordered: false });
    }

    await tempCollection.rename('ADTool', { dropTarget: true });
    tempCollectionName = null; // переименована — чистить нечего

    if (result.length >= SYNC_LIMIT) {
      logger.warn(`Синхронизация ADTool: достигнут лимит ${SYNC_LIMIT} строк — часть данных в SQL могла не попасть в выгрузку.`);
    }
    logger.info(`Синхронизация ADTool завершена: ${result.length} записей.`);
    return { success: `Синхронизация завершена успешно (${result.length} записей).` };

  } catch (err) {
    logger.error(`Ошибка при выполнении периодической задачи: ${err}`);
    return { error: 'Ошибка синхронизации: ' + err.message };
  } finally {
    // если что-то упало до переименования — убираем временную коллекцию
    if (tempCollectionName && mongoose.connection.readyState === 1) {
      try {
        await mongoose.connection.db.collection(tempCollectionName).drop();
        logger.warn(`Временная коллекция ${tempCollectionName} удалена после ошибки.`);
      } catch (err) {
        logger.warn(`Не удалось удалить временную коллекцию ${tempCollectionName}: ${err.message}`);
      }
    }
  }
}

// Переменная для хранения идентификатора интервала
let intervalId = null;
let intervalToFetch = null;

// Функция для запуска периодической задачи
async function startPeriodicTask(interval = 60000 * 60 * 3) { // По умолчанию каждый 3 часа
  if (intervalId) {
    // уже запущена: если интервал изменился — перезапускаем
    if (intervalToFetch === interval) {
      return {warn:'Периодическая задача уже запущена с этим интервалом'}
    }
    stopPeriodicTask();
  }
  if (interval > 0) {
    intervalToFetch = interval
    intervalId = setInterval(getAndRewriteArchiveData, interval);
    return {success:`Периодическая задача запущена с интервалом ${interval / 60000 / 60} ч`}
  }
  return {warn:'Интервал периодической задачи не может быть отрицательным или равным нулю'}
}

// функция для остановки периодической задачи
function stopPeriodicTask() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    intervalToFetch = null
    return {success:'Периодическая задача остановлена'}
  } else {
    return {error:'Периодическая задача не была запущена'}
  }
}

function getIntervalTime() {
  return intervalToFetch ? intervalToFetch / 60000 / 60 : null;
}

module.exports = {
    getDataFromTable,
    startPeriodicTask,
    stopPeriodicTask,
    getAndRewriteArchiveData,
    getIntervalTime
}
