const router = require('express').Router();
const User = require('../models/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const authController = require('../controllers/authController');

// Đăng ký tài khoản

router.post("/register", authController.register);

router.post("/login", authController.login);

// Lấy thông tin user hiện tại từ token
router.get("/me", authController.getMe);

// refresh token
router.post("/refresh", authController.requestRefreshToken);    

// Đăng xuất
router.post("/logout", authController.logout);

module.exports = router;