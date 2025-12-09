const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        minlength: 5,
        maxlength: 20
    },
    password: {
        type: String,
        required: true,
        minlength: 3,
        maxlength: 100
    },
    email: {
        type: String,
        required: true, 
        unique: true,
        minlength: 8,
        maxlength: 50
    },
    admin: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

module.exports = mongoose.model("User", userSchema, "users");