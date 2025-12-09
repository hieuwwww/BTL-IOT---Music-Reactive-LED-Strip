const router = require('express').Router();
const userController = require('../controllers/userController');
const middlewareController = require('../controllers/middlewareController');

// Lấy tất cả người dùng
router.get("/", middlewareController.verifyToken, userController.getAllUser);

// Xóa người dùng theo ID (nếu cần)
router.delete("/:id", middlewareController.verifyTokenAndAdminAuth, userController.deleteUser);


module.exports = router;