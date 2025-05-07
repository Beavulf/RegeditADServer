const express = require('express');
const router = express.Router();
const authRoutes = require('./authRouter.js');
const feedbackRoutes = require('./feedBackRoutes.js');
const sqlRoutes = require('./sqlRoutes.js');

require('dotenv').config();

router.use('/', authRoutes);
router.use('/', feedbackRoutes);
router.use('/', sqlRoutes);

module.exports = router;