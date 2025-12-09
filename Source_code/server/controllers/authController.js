const bcrypt = require('bcrypt');
const User = require('../models/User');
const jwt = require('jsonwebtoken');

let refreshTokens = [];

const authController = {
    register: async (req, res) => {
        try {
            const salt = await bcrypt.genSalt(10);
            const { username, email, password } = req.body;
            // Kiểm tra xem username hoặc email đã tồn tại chưa
            const existingUser = await User.findOne({ $or: [{ username: username }, { email: email }] });           
            if (existingUser) {
                return res.status(400).json({ message: 'Username hoặc email đã được sử dụng.' });
            }
            // Băm mật khẩu trước khi lưu
            const hashedPassword = await bcrypt.hash(password, salt);
            const newUser = new User({
                username: username,
                email: email,
                password: hashedPassword
            });
            const savedUser = await newUser.save();
            // Tạo token giống như khi đăng nhập để client có thể tự động đăng nhập sau đăng ký
            const token = jwt.sign(
                { id: savedUser._id, admin: savedUser.admin },
                "duongthun",
                { expiresIn: '1h' }
            );
            const refreshToken = jwt.sign(
                { id: savedUser._id, admin: savedUser.admin },
                "duongthun_refresh",
                { expiresIn: '7d' }
            );
            refreshTokens.push(refreshToken);
            res.cookie("refreshToken", refreshToken, {
                httpOnly: true,
                secure: false,
            });

            // Return user without password
            const userSafe = { ...savedUser._doc };
            delete userSafe.password;

            res.status(201).json({ message: 'Đăng ký thành công!', user: userSafe, token });
        } catch (error) {
            console.error('Lỗi đăng ký tài khoản:', error);
            res.status(500).json({ message: 'Lỗi máy chủ. Vui lòng thử lại sau.' });
        }   
    },

    getMe: async (req, res) => {
        try {
            // Hỗ trợ header 'authorization' hoặc 'token'
            const authHeader = req.headers.authorization || req.headers.token;
            if (!authHeader) return res.status(401).json({ message: 'Bạn cần đăng nhập' });
            const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader.split(' ')[1] || authHeader;
            jwt.verify(token, "duongthun", async (err, userData) => {
                if (err) return res.status(403).json({ message: 'Token không hợp lệ' });
                const user = await User.findById(userData.id).select('-password');
                if (!user) return res.status(404).json({ message: 'Người dùng không tồn tại' });
                res.status(200).json({ user });
            });
        } catch (error) {
            console.error('Lỗi getMe:', error);
            res.status(500).json({ message: 'Lỗi máy chủ' });
        }
    },

    login: async (req, res) => {
        try {
            const { username, password } = req.body;
            const user = await User.findOne({ username: username });
            if (!user) {
                return res.status(400).json({ message: 'Sai tên đăng nhập hoặc mật khẩu.' });
            }
            const validPassword = await bcrypt.compare(password, user.password);
            if (!validPassword) {
                return res.status(400).json({ message: 'Sai tên đăng nhập hoặc mật khẩu.' });
            }
            
            // res.status(200).json({ message: 'Đăng nhập thành công!', token: token });
            if (user && validPassword) {
                // Tạo JWT token
                const token = jwt.sign(
                    { id: user._id, admin: user.admin },
                    "duongthun", 
                    { expiresIn: '1h' }
                );
                const refreshToken = jwt.sign(
                    { id: user._id, admin: user.admin },
                    "duongthun_refresh",    
                    { expiresIn: '7d' }
                );
                refreshTokens.push(refreshToken);
                // Gửi token trong cookie (có thể tùy chỉnh theo yêu cầu)   
                res.cookie("refreshToken", refreshToken, {  
                    httpOnly: true,
                    secure: false, // Chỉ true nếu dùng HTTPS
                });
                res.status(200).json({user, token, message: 'Đăng nhập thành công!' });
            }
        } catch (error) {
            console.error('Lỗi đăng nhập:', error);
            res.status(500).json({ message: 'Lỗi máy chủ. Vui lòng thử lại sau.' });
        }
    },
    requestRefreshToken: (req, res) => {
        const refreshToken = req.cookies.refreshToken;  
        if (!refreshToken) {
            return res.status(401).json("Bạn cần đăng nhập để thực hiện hành động này!");
        }
        if (!refreshTokens.includes(refreshToken)) {
            return res.status(403).json("Token không hợp lệ!");
        }
        jwt.verify(refreshToken, "duongthun_refresh", (err, user) => {
            if (err) {
                console.error('Lỗi xác thực refresh token:', err);
                return res.status(403).json("Token không hợp lệ!");
            }
            refreshTokens = refreshTokens.filter(token => token !== refreshToken);
            const newToken = jwt.sign(
                { id: user.id, admin: user.admin },
                "duongthun",
                { expiresIn: '1h' }
            );
            refreshTokens.push(newToken);
            res.cookie("refreshToken", newToken, {  
                httpOnly: true,
                secure: false, // Chỉ true nếu dùng HTTPS
            });
            res.status(200).json({ token: newToken });
        });
    },
    logout: (req, res) => {
        const refreshToken = req.cookies.refreshToken;  
        refreshTokens = refreshTokens.filter(token => token !== refreshToken);
        res.clearCookie("refreshToken");
        res.status(200).json({ message: 'Đăng xuất thành công!' });
    }   
};


module.exports = authController;