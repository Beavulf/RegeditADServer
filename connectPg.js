const { Pool } = require('pg');
const mongoose = require('mongoose');
require('dotenv').config()
const {logger} = require('./helper/Logger.js');

// русские названия типов задач (метки должны совпадать с BTN_LIST_ADTOOL в SotrInfo.jsx!)
const TYPE_LABELS = {
  OTPYSK: 'Отпуск',
  STAJIROVKA: 'Стажировка',
  PRODLENIE_OTPYSKA: 'Продление отп.',
  KOMANDIROVKA: 'Командировка',
  UCHEBA: 'Учеба',
  DEKRET: 'Декрет',
  SOC_OTPYSK: 'Соц. отпуск',
};

// источник данных — PostgreSQL приложения WEB AD Tools (schedule-ad-blocker)
const ARCHIVE_TABLE = 'archive_schedules';
// лимит строк, выгружаемых за одну синхронизацию
const SYNC_LIMIT = 10000;

// пул подключений к PostgreSQL
const pool = new Pool({
  host: process.env.PG_HOST,
  port: +(process.env.PG_PORT || 5432),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  connectionTimeoutMillis: 30000,
  query_timeout: 30000,
  max: 5,
});

// дескриптор MongoDB из общего подключения mongoose (ожидание готовности)
function getMongoDb() {
  const conn = mongoose.connection;
  if (conn.readyState !== 1) {
    throw new Error('MongoDB ещё не подключена, синхронизация невозможна.');
  }
  return conn.db;
}

// чтение архива расписаний (история блокировок AD-аккаунтов) из базы WEB AD Tools
async function getArchiveSchedules() {
  const res = await pool.query(
    `SELECT fio, login, type, "order", "startDate", "endDate", "createdBy", "createdAt"
     FROM ${ARCHIVE_TABLE}
     ORDER BY "createdAt" DESC
     LIMIT ${SYNC_LIMIT}`
  );
  return res.rows;
}

// маппинг полей PostgreSQL в формат коллекции ADTool
function mapArchiveRow(row) {
  return {
    login: row.login,
    fio: row.fio,
    date_s: row.startDate,
    date_p: row.endDate,
    prikaz: row.order,
    who: row.createdBy,
    date_z: row.createdAt,
    descriptions: TYPE_LABELS[row.type] || row.type || '',
    is_locked: false,
  };
}

// синхронизация: PostgreSQL -> MongoDB (коллекция ADTool)
async function syncArchiveToMongo() {
  let tempCollectionName = null;

  try {
    const rows = await getArchiveSchedules();
    if (rows.length === 0) {
      return { success: 'Нет данных для синхронизации' };
    }

    // Атомарная замена: заливаем во временную коллекцию и переименовываем,
    // чтобы у клиентов не было «окна» с пустой коллекцией
    const db = getMongoDb();
    tempCollectionName = `ADTool_sync_${Date.now()}`;
    const tempCollection = db.collection(tempCollectionName);

    const mapped = rows.map(mapArchiveRow);
    const batchSize = 1000;
    for (let i = 0; i < mapped.length; i += batchSize) {
      await tempCollection.insertMany(mapped.slice(i, i + batchSize), { ordered: false });
    }

    await tempCollection.rename('ADTool', { dropTarget: true });
    tempCollectionName = null; // переименована — чистить нечего

    if (rows.length >= SYNC_LIMIT) {
      logger.warn(`Синхронизация ADTool: достигнут лимит ${SYNC_LIMIT} строк — часть данных в PostgreSQL могла не попасть в выгрузку.`);
    }
    logger.info(`Синхронизация ADTool завершена: ${rows.length} записей из ${ARCHIVE_TABLE}.`);

    // уведомляем сервер (server.js) — чтобы разослать клиентам предупреждение об обновлении данных
    process.emit('adtool:synced', rows.length);
    return { success: `Синхронизация завершена успешно (${rows.length} записей).` };

  } catch (err) {
    logger.error(`Ошибка при синхронизации ADTool из PostgreSQL: ${err}`);
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
    intervalId = setInterval(syncArchiveToMongo, interval);
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

// закрытие пула PostgreSQL при остановке сервера
async function closePool() {
  try { await pool.end(); } catch {}
}

module.exports = {
    getArchiveSchedules,
    syncArchiveToMongo,
    startPeriodicTask,
    stopPeriodicTask,
    getIntervalTime,
    closePool
}
