const express = require('express');
const multer = require('multer');
const path = require('path');
const schemas = require('../mongoose.js');
const { logger } = require('../helper/Logger.js');

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
        logger.error(`Ошибка при отправке Feedback на сервере. ${error}`);
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

module.exports = router;
