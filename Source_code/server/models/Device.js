const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  _id: String, // deviceId (dùng làm _id luôn)
  mac: { type: String, unique: true, sparse: true },
  model: String,
  firmware: String,
  name: String,
  wifi_ssid: String,
  wifi_pass: String,
  status: { type: String, default: 'offline' },
  last_online: Date
}, { 
  timestamps: true,
  collection: 'devices'   // ← Collection riêng cho thiết bị
});

module.exports = mongoose.model("Device", deviceSchema);