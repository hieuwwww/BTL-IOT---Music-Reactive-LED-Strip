// Server đóng vai trò là cầu nối Socket.IO <-> MQTT
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mqtt = require('mqtt');
// NEW: Thêm import cho file upload và DB
const mongoose = require('mongoose');

const Music = require('./models/Music'); // Tự định nghĩa Schema
const Device = require('./models/Device');
const multer = require('multer');

// Khai báo thư mục lưu trữ file nhạc
const UPLOAD_FOLDER = 'public/music';

// Cấu hình lưu trữ của Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Đảm bảo thư mục tồn tại, nếu không Multer sẽ báo lỗi
    // (Bạn nên tạo thư mục này thủ công: public/music)
    cb(null, UPLOAD_FOLDER);
  },
  filename: (req, file, cb) => {
    // Tạo tên file duy nhất để tránh trùng lặp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    // Lấy đuôi mở rộng (ví dụ: .mp3, .wav)
    const ext = file.originalname.split('.').pop();
    cb(null, file.fieldname + '-' + uniqueSuffix + '.' + ext);
  }
});

const upload = multer({
  storage: storage
});
// --- Cấu hình Server ---
const PORT = 3000;

// --- Cấu hình MQTT Broker (Cần phải khớp với cài đặt Mosquitto) ---
// THAY ĐỔI IP NÀY CHO PHÙ HỢP VỚI MÁY CHẠY BROKER CỦA BẠN!
const MQTT_BROKER_URL = 'mqtt://localhost:1883';
// NEW: Cấu hình MongoDB
// const MONGO_URI = 'mongodb://localhost:27017/musicReactiveLed';
const MONGO_URI = 'mongodb+srv://admin:mJhuNbxji1Rf3sZD@ve-xe.gmmgk.mongodb.net/musicLed?retryWrites=true&w=majority&appName=ve-xe';

const FIRMWARE_HTTP_PORT = 8080;

// --- Tạo thư mục nếu chưa tồn tại ---
const fs = require('fs');
const path = require('path');

const publicMusicDir = path.join(__dirname, 'public', 'music');
if (!fs.existsSync(publicMusicDir)) {
  fs.mkdirSync(publicMusicDir, { recursive: true });
  console.log(`✓ Tạo thư mục: ${publicMusicDir}`);
}

// --- Khởi tạo ---
const app = express();

// CORS middleware cho tất cả Express routes (HTTP requests)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json()); // Dùng để xử lý body JSON cho API
app.use(express.static('public')); // Cần thiết để phục vụ file nhạc (vd: public/music/...)

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Cho phép kết nối từ mọi domain (trong môi trường phát triển)
    methods: ["GET", "POST"]
  }
});

const mqttClient = mqtt.connect(MQTT_BROKER_URL);

// Biến lưu trữ trạng thái cuối cùng nhận được từ ESP32
let lastStatus = "Đang kết nối..."; // Khởi tạo giá trị ban đầu
// Thêm biến trạng thái kết nối của Node.js Server với Broker
let mqttConnectionStatus = false;
// Định nghĩa các Topic cần theo dõi
const TOPICS_TO_SUBSCRIBE = [
  'led/control/#', // Nhận lệnh điều khiển (Chủ yếu dùng để debug/kiểm tra)
  'led/status', // Nhận trạng thái (online, heartbeat, power_on, v.v.) từ ESP32 [cite: 188]
  'led/config/save', // Theo dõi việc lưu cấu hình [cite: 188]
  // NEW: Thêm topic nhạc để kiểm tra
  'led/control/music_data'
];

// --- LOGIC DATABASE & FILE UPLOAD (CẦN TỰ HOÀN THIỆN) ---
let mongoConnected = false;
mongoose.connect(MONGO_URI)
  .then(() => {
    mongoConnected = true;
    console.log('[DB] MongoDB connected successfully ✓');
  })
  .catch(err => {
    mongoConnected = false;
    console.warn('[DB] MongoDB connection failed (app will still work with file storage only):', err.message);
  });

// 1) device register (called by device or admin)
app.post('/api/devices/register', async (req, res) => {
  try {
    const { deviceId, deviceName, firmware } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: "deviceId is required" });
    }

    const device = await Device.findByIdAndUpdate(
      deviceId,
      {
        name: deviceName || deviceId,
        firmware: firmware || "unknown",
        last_online: new Date(),
        status: "online"
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`[REGISTER] Device registered: ${deviceId} (${deviceName || 'No name'})`);
    res.json({ success: true, device });
  } catch (err) {
    console.error("[REGISTER] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2) list devices
app.get('/api/devices', async (req, res) => {
  const devices = await Device.find().lean();
  res.json(devices);
});

// 3) get device
app.get('/api/devices/:id', async (req, res) => {
  const d = await Device.findById(req.params.id).lean();
  if (!d) return res.status(404).json({ error: 'Not found' });
  res.json(d);
});

// 4) set wifi credentials for device (server -> device via mqtt)
app.post('/api/devices/:id/wifi', async (req, res) => {
  const id = req.params.id;
  const { ssid, password } = req.body;
  if (!ssid) return res.status(400).json({ error: 'ssid required' });

  // save to DB (optionally encrypted)
  await Device.findByIdAndUpdate(id, { wifi_ssid: ssid, wifi_pass: password });

  // publish to device topic
  const topic = `led/control/wifi_config`;
  const payload = JSON.stringify({ ssid, password, deviceName: deviceName || "" });

  mqttClient.publish(topic, payload, { qos: 1 });
});

// API 1: Upload file và lưu vào DB (nếu MongoDB khả dụng)
app.post('/api/music/upload', upload.single('musicFile'), async (req, res) => {
  if (!req.file) {
    console.error('No file uploaded.');
    return res.status(400).json({ error: 'Không có file được tải lên.' });
  }

  try {
    // File được lưu trong 'public/music/' và có thể truy cập qua /music/
    console.log('✓ File uploaded:', req.file.filename, 'Path:', req.file.path);
    
    let savedSong = {
      _id: new Date().getTime(),
      title: req.file.originalname,
      storage_url: `/music/${req.file.filename}`,
      mime_type: req.file.mimetype,
      uploaded_at: new Date()
    };

    // Nếu MongoDB kết nối được, lưu vào DB
    if (mongoConnected) {
      try {
        const newSong = new Music({
          title: req.file.originalname,
          storage_url: `/music/${req.file.filename}`,
          mime_type: req.file.mimetype,
        });
        const dbSong = await newSong.save();
        savedSong = dbSong;
        console.log('✓ Song saved to MongoDB:', dbSong._id);
      } catch (dbErr) {
        console.warn('⚠ Failed to save to MongoDB, using file-only mode:', dbErr.message);
      }
    } else {
      console.warn('⚠ MongoDB not connected, using file-only mode (song will not persist after restart)');
    }
    
    res.status(201).json({
      message: 'Upload thành công',
      song: savedSong,
      mongoConnected: mongoConnected
    });
  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({ error: 'Lỗi Server khi lưu: ' + error.message });
  }
});// API 2: Lấy danh sách nhạc đã lưu (từ MongoDB hoặc file system)
app.get('/api/music/list', async (req, res) => {
  try {
    if (mongoConnected) {
      // Lấy từ MongoDB
      const songs = await Music.find({});
      console.log('✓ Fetched', songs.length, 'songs from MongoDB');
      return res.json(songs);
    } else {
      // Fallback: lấy danh sách file từ public/music
      console.warn('⚠ MongoDB not connected, fetching songs from file system...');
      const fs = require('fs');
      const path = require('path');
      
      const musicDir = path.join(__dirname, 'public', 'music');
      if (!fs.existsSync(musicDir)) {
        return res.json([]);
      }
      
      const files = fs.readdirSync(musicDir);
      const songs = files.map((filename, idx) => ({
        _id: idx,
        title: filename,
        storage_url: `/music/${filename}`,
        mime_type: 'audio/mpeg',
        uploaded_at: new Date()
      }));
      
      console.log('✓ Fetched', songs.length, 'songs from file system');
      return res.json(songs);
    }
  } catch (error) {
    console.error('❌ Error fetching songs:', error);
    res.status(500).json({ error: 'Lỗi Server khi lấy danh sách: ' + error.message });
  }
});

app.post('/api/device/register', async (req, res) => {
  const { device_id, chip, firmware } = req.body;

  if (!device_id) return res.status(400).json({ error: "Missing device_id" });

  const device = await Device.findByIdAndUpdate(
    device_id,
    { chip, firmware, last_online: new Date(), status: "online" },
    { upsert: true, new: true }
  );

  res.json(device);
});

app.post('/api/device/:id/wifi', async (req, res) => {
  const { ssid, password } = req.body;
  const id = req.params.id;

  await Device.findByIdAndUpdate(id, { wifi_ssid: ssid, wifi_pass: password });

  mqttClient.publish(`/device/${id}/wifi_config`, JSON.stringify({ ssid, password }));

  res.json({ message: "WiFi sent to device" });
});

// -------------------------------------------------------------------
// A. MQTT -> SOCKET.IO (Giám sát Trạng thái)
// -------------------------------------------------------------------

mqttClient.on('connect', () => {
  mqttConnectionStatus = true; // Cập nhật trạng thái kết nối Broker
  console.log(`MQTT Broker kết nối OK tại: ${MQTT_BROKER_URL}`);

  // Subscribe các topic đã định nghĩa
  TOPICS_TO_SUBSCRIBE.forEach(topic => {
    mqttClient.subscribe(topic, (err) => {
      if (err) {
        console.error(`Subscription failed for topic ${topic}:`, err);
      } else {
        console.log(`Subscribed: ${topic}`);
      }
    });
  });
});

mqttClient.on('error', (err) => {
  mqttConnectionStatus = false; // Cập nhật trạng thái khi có lỗi
  console.error('MQTT Connection Error:', err);
});
mqttClient.on('close', () => {
  console.log('MQTT connection closed.');
  mqttConnectionStatus = false; // Cập nhật trạng thái khi ngắt kết nối
});
// Lắng nghe tin nhắn từ Broker (Tức là tin nhắn từ ESP32)
mqttClient.on('message', (topic, message) => {
  const payload = message.toString();

  // Cập nhật trạng thái cuối cùng nếu là topic trạng thái
  if (topic === 'led/status') {
    lastStatus = payload; // LƯU TRỮ TRẠNG THÁI CUỐI CÙNG
  }

  // Phát sóng trạng thái từ ESP32 tới TẤT CẢ các client Web đang kết nối
  io.emit('mqtt', {
    topic: topic,
    payload: payload
  });
  console.log(`MQTT -> Web: [${topic}] ${payload}`);
});


// -------------------------------------------------------------------
// B. SOCKET.IO -> MQTT (Điều khiển Thủ công)
// -------------------------------------------------------------------

io.on('connection', (socket) => {
  console.log(`Web client kết nối: ${socket.id}`);
  // NEW: Xử lý dữ liệu phân tích nhạc real-time từ Web (Chế độ 2)
  socket.on('music_sync', (data) => {
    // Data mong đợi: { bass: number, mid: number, treble: number }
    const {
      bass,
      mid,
      treble
    } = data;

    // Kiểm tra dữ liệu hợp lệ (0-255)
    if (typeof bass === 'number' && typeof mid === 'number' && typeof treble === 'number') {
      // Định dạng payload: "BASS,MID,TREBLE"
      const payload = `${Math.round(bass)},${Math.round(mid)},${Math.round(treble)}`;
      const topic = 'led/control/music_data';

      // Gửi ngay lập tức tới MQTT Broker
      mqttClient.publish(topic, payload, {
        qos: 0,
        retain: false
      }, (err) => {
        if (err) {
          console.error(`Failed to publish music data to ${topic}:`, err);
        } else {
          // console.log(`Web -> ESP32 Music Data: ${payload}`); // Bỏ comment để debug
        }
      });
    } else {
      console.error("Invalid music_sync data received:", data);
    }
  });

  // Lắng nghe sự kiện 'control' từ Web Frontend (Gửi lệnh Bật/Tắt, Màu sắc, Mode)
  // Payload mong đợi: { topic: "led/control/power", payload: "on" } [cite: 147]
  socket.on('control', (data) => {
    const {
      topic,
      payload
    } = data;

    if (!topic || !payload) {
      console.error("Invalid control data received:", data);
      return;
    }
    // FIX: Gửi trạng thái cuối cùng cho client ngay lập tức
    socket.emit('mqtt', {
      topic: 'led/status',
      payload: lastStatus
    });
    console.log(`[INIT] Gửi trạng thái ban đầu tới ${socket.id}: ${lastStatus}`);

    // Chuyển tiếp lệnh điều khiển từ Web đến MQTT Broker [cite: 191]
    mqttClient.publish(topic, payload.toString(), {
      qos: 0,
      retain: false
    }, (err) => {
      if (err) {
        console.error(`Failed to publish to ${topic}:`, err);
        // Có thể gửi phản hồi lỗi lại cho client Web ở đây
        socket.emit('error', 'Lỗi gửi lệnh đến Broker.');
      } else {
        console.log(`Web -> ESP32: ${topic} ${payload}`);
        // Gửi xác nhận hoặc thông báo cập nhật thành công (tuỳ chọn)
      }
    });
  });

  socket.on('disconnect', () => {
    console.log(`Web client ngắt kết nối: ${socket.id}`);
  });
});

// -------------------------------------------------------------------
// C. Khởi chạy HTTP Server
// -------------------------------------------------------------------

server.listen(PORT, () => {
  console.log(`Server Node.js đang chạy tại http://localhost:${PORT}`);
});

// API 3: Xóa file nhạc và (nếu có) record trong MongoDB
app.delete('/api/music/:id', express.json(), async (req, res) => {
  const id = req.params.id;
  const { filename } = req.body || {};

  try {
    // Nếu MongoDB kết nối và id có khả năng là ObjectId hoặc DB id
    if (mongoConnected) {
      try {
        const doc = await Music.findByIdAndDelete(id);
        if (doc) {
          // xóa file
          const filePath = path.join(__dirname, 'public', 'music', path.basename(doc.storage_url));
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          console.log('✓ Deleted song and file for id:', id);
          return res.json({ message: 'Deleted', id, mongoConnected: true });
        }
      } catch (e) {
        // proceed to try filename-based deletion
      }
    }

    // Nếu không tìm được trong DB hoặc DB không kết nối, dùng filename param hoặc id as filename
    const targetFilename = filename || id;
    const cleanName = path.basename(targetFilename);
    const filePath = path.join(__dirname, 'public', 'music', cleanName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('✓ Deleted file:', cleanName);
      return res.json({ message: 'Deleted file', filename: cleanName, mongoConnected });
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (error) {
    console.error('❌ Delete error:', error);
    return res.status(500).json({ error: 'Delete failed: ' + error.message });
  }
});