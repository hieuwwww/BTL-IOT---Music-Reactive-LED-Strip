const User = require('../models/User');

const userController = {
    // Thêm các phương thức xử lý người dùng ở đây
    getAllUser: async (req, res) => {
        try {
            const users = await User.find();
            res.status(200).json(users);
        } catch (error) {
            console.error('Lỗi lấy danh sách người dùng:', error);
            res.status(500).json({ message: 'Lỗi máy chủ. Vui lòng thử lại sau.' });
        }
    },
    deleteUser: async (req, res) => {
        try {
            const userId = req.params.id;
            await User.findByIdAndDelete(userId);
            res.status(200).json({ message: 'Xóa người dùng thành công!' });
        } catch (error) {
            console.error('Lỗi xóa người dùng:', error);
            res.status(500).json({ message: 'Lỗi máy chủ. Vui lòng thử lại sau.' });
        }   
    }
};

module.exports = userController;