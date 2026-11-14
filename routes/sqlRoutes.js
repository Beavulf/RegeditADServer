const express = require('express');
const { syncArchiveToMongo, startPeriodicTask, stopPeriodicTask, getIntervalTime, closePool } = require('../connectPg.js');
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

// запуск интервала синхронизации ADTool из PostgreSQL либо смена времени
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
        logger.error(`Ошибка при запуске интервала синхронизации: ${error}`);
        res.status(500).json({ error: 'Ошибка при запуске функции синхронизации данных.' });
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
        logger.error(`Ошибка при остановке интервала синхронизации: ${error}`);
        res.status(500).json({ error: 'Ошибка при остановке функции синхронизации данных.' });
    }
});

// получение установленого времени интервала
router.get('/intervaltime', async (req, res) => {
    try {
        const time = getIntervalTime()
        if (time) {
            res.status(200).json({ message: time })
        } else {
            res.status(200).json({ message: 'Интервал синхронизации не установлен' })
        }
    } catch (error) {
        logger.error(`Ошибка при получении времени интервала: ${error}`);
        res.status(500).json({ error: 'Ошибка при получении времени интервала синхронизации.' });
    }
});

// принудительная синхронизация данных из PostgreSQL
router.get('/getdatanow', async (req, res) => {
    try {
        const result = await syncArchiveToMongo()
        if (result.success) {
            res.status(200).json({ message: result.success })
        } else {
            res.status(200).json({ message: 'Загрузка данных не была завершена' })
        }
    } catch (error) {
        logger.error(`Ошибка при принудительной синхронизации данных: ${error}`);
        res.status(500).json({ error: 'Ошибка при получении данных на сервере.' });
    }
});

module.exports = router;
