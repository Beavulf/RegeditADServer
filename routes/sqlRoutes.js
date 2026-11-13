const express = require('express');
const { getDataFromTable, startPeriodicTask, getAndRewriteArchiveData, stopPeriodicTask, getIntervalTime } = require('../connectSql.js');
const dbFunc = require('../dbService.js');
const { logger } = require('../helper/Logger.js');

const router = express.Router();

// получение всех записей таблицы ДокаНАСТД
router.get('/allpdoka', async (req, res) => {
    try {
        const allpdoka = await dbFunc.getCollectionMongoose({ collection: 'Pdoka' });
        res.status(200).json(allpdoka);
    } catch (error) {
        logger.error(`Ошибка при получении AllPdoka: ${error}`);
        res.status(500).json({ error: 'Ошибка при получении AllPdoka на сервере.' });
    }
});

// получение данных из SQL базы (таблицы ограничены белым списком в connectSql.js)
router.get('/getsqldata', async (req, res) => {
    const tableName = req.query.tableName;

    if (!tableName) {
        return res.status(400).json({ error: 'Необходимо указать параметр tableName.' });
    }
    try {
        const tableData = await getDataFromTable(tableName)
        res.status(200).json(tableData.recordset);
    }
    catch (error) {
        // таблица вне белого списка — понятная ошибка клиенту, остальное — в лог
        if (error.message?.includes('недоступна для чтения')) {
            return res.status(400).json({ error: error.message });
        }
        logger.error(`Ошибка при получении SQL-данных (${tableName}): ${error}`);
        res.status(500).json({ error: 'Ошибка при получении SQL-данных на сервере.' });
    }
});

// запуск интервала обновления SQL либо смена времени
router.get('/startinterval', async (req, res) => {
    const time = req.query.time

    if (!time || isNaN(time) || time <= 0) {
        return res.status(400).json({ error: 'Необходимо указать положительное числовое значение для параметра time.' });
    }

    try {
        const resStart = await startPeriodicTask(60000 * 60 * time)
        if (resStart.success) {
            res.status(200).json({ message: resStart.success })
        } else {
            res.status(200).json({ message: resStart.warn })
        }
    } catch (error) {
        logger.error(`Ошибка при запуске интервала обновления SQL: ${error}`);
        res.status(500).json({ error: 'Ошибка при запуске функции обновления SQL данных.' });
    }
});

// остановка интервальной задачи
router.get('/stopinterval', async (req, res) => {
    try {
        const resStop = stopPeriodicTask()
        if (resStop.success) {
            res.status(200).json({ message: resStop.success })
        } else {
            res.status(200).json({ message: resStop.error })
        }
    } catch (error) {
        logger.error(`Ошибка при остановке интервала обновления SQL: ${error}`);
        res.status(500).json({ error: 'Ошибка при остановке функции обновления SQL данных.' });
    }
});

// получение установленого времени интервала
router.get('/intervaltime', async (req, res) => {
    try {
        const time = getIntervalTime()
        if (time) {
            res.status(200).json({ message: time })
        } else {
            res.status(200).json({ message: 'Интервал SQL обновления не установлен' })
        }
    } catch (error) {
        logger.error(`Ошибка при получении времени интервала SQL: ${error}`);
        res.status(500).json({ error: 'Ошибка при получении времени интервала SQL обновления.' });
    }
});

// получение (загрузка) данных из таблицы сразу
router.get('/getdatanow', async (req, res) => {
    try {
        const result = await getAndRewriteArchiveData()
        if (result.success) {
            res.status(200).json({ message: result.success })
        } else {
            res.status(200).json({ message: 'Загрузка данных не была завершена' })
        }
    } catch (error) {
        logger.error(`Ошибка при принудительной загрузке данных из SQL: ${error}`);
        res.status(500).json({ error: 'Ошибка при получении данных на сервере.' });
    }
});

module.exports = router;
