const mongoose = require('mongoose');

const musicSchema = new mongoose.Schema({
    // Tên bài hát (lấy từ tên file gốc)
    title: {
        type: String,
        required: true,
        trim: true
    },
    // Đường dẫn để Frontend có thể truy cập và phát (ví dụ: /music/tên_file.mp3)
    storage_url: {
        type: String,
        required: true
    },
    // Loại file (ví dụ: audio/mpeg)
    mime_type: {
        type: String,
        required: true
    },
    // Thời gian bài hát được tải lên
    uploaded_at: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

module.exports = mongoose.model("Music", musicSchema, "musicLibrary");