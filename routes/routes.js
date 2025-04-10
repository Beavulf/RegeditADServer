const express = require('express');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const schemas = require('../mongoose.js');
const dbFunc = require('../dbFunc.js');
const {logger} = require('../helper/Logger.js');
const {getDataFromTable, startPeriodicTask, getAndRewriteArchiveData, stopPeriodicTask, getIntervalTime} = require('../connectSql.js');
const { receiveMessageOnPort } = require('worker_threads');

require('dotenv').config();

const secretKey = process.env.JWT_SECRET_KEY;

module.exports = function(db) {
    const router = express.Router();

    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, 'uploads/');
        },
        filename: (req, file, cb) => {
            cb(null, Date.now() + path.extname(file.originalname));
        },
    });

    const fileFilter = (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Недопустимый тип файла'), false);
        }
    };

    const upload = multer({
        storage,
        fileFilter,
        limits: {
            fileSize: 5 * 1024 * 1024
        }
    });

    // авторизация клиента и выдача ему токена
    router.post('/login', async (req, res) => {
        try {
            const { address } = req.body;
            const authUser = await dbFunc.getCollectionMongoose({collection: `Users`, filter: {address:address}}, db);
            if (authUser.length>0) {
                const user = authUser[0];    
                const token = jwt.sign({ address, role: user.role, username:user.name }, secretKey, { expiresIn: '1h' });
                logger.info(`Успешная авторизация пользователя | ${req.ip}.`);
                return res.json({ token, role:user.role });
            } else {
                logger.warn(`Попытка входа неавторизованного пользователя с | ${req.ip}.`);
                res.status(401).json({ error: 'Неверные учетные данные' });
            }
        } catch(err) {
            logger.error(`Ошибка при попытке авторизации пользователя.\n ${err}`);
            res.status(500).json({ error: 'Ошибка при авторизации на сервере.' });
        }
    });

    // получение адреся подключаемого клиента
    router.get('/adress', (req, res) => res.json({ ip: req.ip }));

    // отправка запроса на получение доступа
    router.post('/access', async (req, res) => {
        try {
            const { text } = req.body;    
            const data = {
                collection: `Access`,
                body: { address:text.client, login:text.login, is_locked: false, data_dob:new Date() },
            };
            const resInsert = await dbFunc.insertInToCollection(data, db);
            if (resInsert.error) {
                logger.warn(`Попытка отправки повтороно запроса на предоставление доступа: ${text.client}`);
                res.status(401).json({ error: 'Вы уже отправляли запрос' });
            } else {
                logger.info(`Отправлен запрос на предоставление доступа: ${text.client}`);
                res.status(200).json({ message: 'Отправлено' });
            }
        } catch(err) {
            logger.error(`Ошибка при отправке запроса на доступ.\n ${err}`);
            res.status(500).json({ error: 'Ошибка на сервере, при запроса доступа.' });
        }
    });

    // создание фидбэка
    router.post('/feedback', upload.single('image'), async (req, res) => {
        try {
            const { title, descrip, _who, status } = req.body;
            const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

            const feedback = schemas.Feedback({
                title,
                descrip,
                _who,
                status,
                data_dob: new Date(),
                is_locked: false,
                image: imagePath
            });
            await feedback.save();
            logger.info(`Feedback успешно отправлен - ${_who}`);
            res.status(201).json({ message: 'Feedback успешно отправлен!' });
        } catch (error) {
            logger.error(`Ошибка при отправке Feedback на сервере. ${err}`);
            res.status(500).json({ error: 'Ошибка при отправке Feedback, на сервере' });
        }
    });

    // получение всех Feedback
    router.get('/feedbacks', async (req, res) => {
        try {
            const feedbacks = await schemas.Feedback.find();
            res.status(200).json(feedbacks);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при получении Feedback, на сервере' });
        }
    });

    // удаление фидбэка
    router.post('/feedbackdel', async (req, res) => {
        try {
            const { id } = req.body;
            const deletedFeedback = await schemas.Feedback.findByIdAndDelete(id);
            
            if (!deletedFeedback) {
                return res.status(404).json({ error: 'Feedback для удаления не найден' });
            }
            logger.info(`Feedback успешно удален - ${id}}`);
            res.status(200).json({ message: 'Feedback удален успешно' });
        } catch (error) {
            console.error(error);
            logger.error(`Ошибка удаления feedback: ${error}`);
            res.status(500).json({ error: 'Ошибка сервера, при удалении feedback' });
        }
    });

    // получение всех записей таблицы ДокаНАСТД
    router.get('/allpdoka', async (req, res) => {
        try {
            const allpdoka = await dbFunc.getCollectionMongoose({collection: 'Pdoka'}, db);
            res.status(200).json(allpdoka);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при получении AllPdoka, на сервере' });
        }
    });

    // получение данных из SQL базы
    router.get('/getsqldata', async (req, res) => {
        const tableName = req.query.tableName;
        
        if (!tableName) {
            return res.status(400).send('Необходимо указать параметр tableName');
        }
        try {
            const tableData = await getDataFromTable(tableName)
            if (!tableData) {
                return res.status(404).send('Таблица не найдена');
            }
            res.json(tableData.recordset);
        }
        catch (error) {
            logger.error(`Ошибка SQL запроса: ${error}`);
            res.status(500).json({ error: 'Ошибка при получении SQL-данных, на сервере' });
        }
    });

    // запуск интервала обновления SQL либо смена времени
    router.get('/startinterval', async (req, res) => {
        const time = req.query.time

        if (!time || isNaN(time) || time <= 0) {
            return res.status(400).json({ error: 'Необходимо указать положительное числовое значение для параметра time' });
        }

        try {
            const stopResult = stopPeriodicTask();
            const resStart = await startPeriodicTask(60000 * 60 * time)
            if (resStart.success) {
                res.status(200).json({message: resStart.success})
            } else {
                res.status(200).json({message: resStart.warn})
            }
        } catch (error) {
            logger.error(`Ошибка запуска SQL обновления: ${error}`);
            res.status(500).json({ error: 'Ошибка при запуске функции обновления SQL данных.' });
        }
    });

    // остановка интервальной задачи
    router.get('/stopinterval', async (req, res) => {
        try {
            const resStop = stopPeriodicTask()
            if (resStop.success) {
                res.status(200).json({message: resStop.success})
            } else {
                res.status(200).json({message: resStop.error})
            }
        } catch (error) {
            logger.error(`Ошибка остановки SQL обновления: ${error}`);
            res.status(500).json({ error: `Ошибка при остановке функции обновления SQL данных. ${error}` });
        }
    });

    // получение установленого времени интервала
    router.get('/intervaltime', async (req, res) => {
        try {
            const time = getIntervalTime()
            if (time) {
                res.status(200).json({message: time})
            } else {
                res.status(200).json({message: 'Интервал SQL обновления не установлен'})
            }
        } catch (error) {
            logger.error(`Ошибка получении времени интервала SQL обновления: ${error}`);
            res.status(500).json({ error: `Ошибка пполучении времени интервала SQL обнолвения. ${error}` });
        }
    });

    // получение (загрузка) данных из таблицы сразу
    router.get('/getdatanow', async (req, res) => {
        try {

            const result = await getAndRewriteArchiveData()            
            if (result.success) {
                res.status(200).json({message: result.success})
            } else {
                res.status(200).json({message: 'Загрузка данных не была завершена'})
            }
        } catch (error) {
            logger.error(`Ошибка получении данных: ${error}`);
            res.status(500).json({ error: `Ошибка пполучении данных. ${error}` });
        }
    });

    return router;
};
