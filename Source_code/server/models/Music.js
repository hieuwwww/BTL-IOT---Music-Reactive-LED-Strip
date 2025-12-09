const mongoose = require('mongoose');

const musicSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    storage_url: {
        type: String,
        required: true,
        unique: true
    },
    mime_type: {
        type: String,
        required: true
    },
    uploaded_at: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    collection: 'musicLibrary'   // ← Collection chứa nhạc
});

module.exports = mongoose.model("Music", musicSchema);