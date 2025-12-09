const jwt = require('jsonwebtoken');
const middlewareController = {
    verifyToken: (req, res, next) => {
        const authHeader = req.headers.token;
        if (authHeader) {
            const token = authHeader.split(" ")[1];
            jwt.verify(token, "duongthun", (err, user) => {
                if (err) {
                    return res.status(403).json("Token không hợp lệ!");
                }
                req.user = user;
                next();
            });
        } else {
            return res.status(401).json("Bạn cần đăng nhập để thực hiện hành động này!");
        }   
    },

    verifyTokenAndAdminAuth: (req, res, next) => {
        middlewareController.verifyToken(req, res, () => {
            if (req.user.admin || req.user.id === req.params.id) {
                next(); 
            } else {
                res.status(403).json("Bạn không có quyền thực hiện hành động này!");
            }
        });
    }
};

module.exports = middlewareController;