const express = require('express');
const jwt = require('jsonwebtoken');
const dbFunc = require('../dbFunc.js');
const { logger } = require('../helper/Logger.js');

const router = express.Router();
require('dotenv').config();
const secretKey = process.env.JWT_SECRET_KEY;

// авторизация клиента и выдача ему токена
router.post('/login', async (req, res) => {
    try {
        const { address } = req.body;
        const authUser = await dbFunc.getCollectionMongoose({collection: `Users`, filter: {address:address}}); //ищем в бд пользователя
        if (authUser.length > 0) {  
            const user = authUser[0];    
            const token = jwt.sign({ address, role: user.role, username:user.name }, secretKey, { expiresIn: '1h' });

            res.cookie('token', token, {
                httpOnly: true,     // Защита от XSS (JavaScript не получит доступ)
                sameSite: 'lax', // Защита от CSRF
                maxAge: 3600000,    // Время жизни (1 час)
            });

            logger.info(`Успешная авторизация пользователя | ${address}.`);
            return res.status(201).json({ token, role:user.role });
        } else {
            logger.warn(`Попытка входа неавторизованного пользователя с | ${req.ip}.`);
            res.status(401).json({ error: 'Неверные учетные данные' });
        }
    } catch(err) {
        logger.error(`Ошибка при попытке авторизации пользователя.\n ${err}`);
        res.status(500).json({ error: `Ошибка при авторизации на сервере. ${err}` });
    }
});

// получение адреся подключаемого клиента
router.get('/adress', (req, res) => res.json({ ip: req.ip }));

// отправка запроса на получение доступа
router.post('/access', async (req, res) => {
    try {
        const { userData } = req.body;    
        const data = {
            collection: `Access`,
            body: { address:userData.client, login:userData.login, is_locked: false, data_dob:new Date() },
        };
        const resInsert = await dbFunc.insertInToCollection(data);
        if (resInsert.error) {
            logger.warn(`Попытка отправки повтороно запроса на предоставление доступа: ${userData.client}`);
            res.status(401).json({ error: 'Вы уже отправляли запрос' });
        } else {
            logger.info(`Отправлен запрос на предоставление доступа: ${userData.client}`);
            res.status(200).json({ message: 'Отправлено' });
        }
    } catch(err) {
        logger.error(`Ошибка при отправке запроса на доступ.\n ${err}`);
        res.status(500).json({ error: `Ошибка на сервере, при запроса доступа. ${err}` });
    }
});

module.exports = router