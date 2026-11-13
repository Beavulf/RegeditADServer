const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const authRoutes = require('./authRouter.js');
const feedbackRoutes = require('./feedBackRoutes.js');
const sqlRoutes = require('./sqlRoutes.js');

require('dotenv').config();
const secretKey = process.env.JWT_SECRET_KEY;

// публичные HTTP-роуты (до аутентификации): логин, получение своего IP и запрос доступа
router.use('/', authRoutes);

// все остальные HTTP-роуты требуют валидный JWT из cookie
router.use((req, res, next) => {
    const token = req.cookies?.token;
    if (!token) {
        return res.status(401).json({ error: 'Требуется авторизация.' });
    }
    try {
        req.user = jwt.verify(token, secretKey); // данные пользователя доступны обработчикам как req.user
        next();
    } catch {
        return res.status(401).json({ error: 'Токен недействителен, авторизуйтесь заново.' });
    }
});

router.use('/', feedbackRoutes);
router.use('/', sqlRoutes);

module.exports = router;
