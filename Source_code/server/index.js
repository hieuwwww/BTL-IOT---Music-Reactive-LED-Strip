// Server đóng vai trò là cầu nối Socket.IO <-> MQTT
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mqtt = require('mqtt');

// --- Cấu hình Server ---
const PORT = 3000;

// --- Cấu hình MQTT Broker (Cần phải khớp với cài đặt Mosquitto) ---
// THAY ĐỔI IP NÀY CHO PHÙ HỢP VỚI MÁY CHẠY BROKER CỦA BẠN!
const MQTT_BROKER_URL = 'mqtt://localhost:1883'; 

// --- Khởi tạo ---
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*", // Cho phép kết nối từ mọi domain (trong môi trường phát triển)
        methods: ["GET", "POST"]
    }
});

const mqttClient = mqtt.connect(MQTT_BROKER_URL);

// Định nghĩa các Topic cần theo dõi
const TOPICS_TO_SUBSCRIBE = [
    'led/control/#', // Nhận lệnh điều khiển (Chủ yếu dùng để debug/kiểm tra)
    'led/status',    // Nhận trạng thái (online, heartbeat, power_on, v.v.) từ ESP32 [cite: 188]
    'led/config/save'// Theo dõi việc lưu cấu hình [cite: 188]
];

// -------------------------------------------------------------------
// A. MQTT -> SOCKET.IO (Giám sát Trạng thái)
// -------------------------------------------------------------------

mqttClient.on('connect', () => {
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
    console.error('MQTT Connection Error:', err);
});

// Lắng nghe tin nhắn từ Broker (Tức là tin nhắn từ ESP32)
mqttClient.on('message', (topic, message) => {
    const payload = message.toString();
    
    // Phát sóng trạng thái từ ESP32 tới TẤT CẢ các client Web đang kết nối [cite: 186]
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
    
    // Lắng nghe sự kiện 'control' từ Web Frontend (Gửi lệnh Bật/Tắt, Màu sắc, Mode)
    // Payload mong đợi: { topic: "led/control/power", payload: "on" } [cite: 147]
    socket.on('control', (data) => {
        const { topic, payload } = data;

        if (!topic || !payload) {
            console.error("Invalid control data received:", data);
            return;
        }

        // Chuyển tiếp lệnh điều khiển từ Web đến MQTT Broker [cite: 191]
        mqttClient.publish(topic, payload.toString(), { qos: 0, retain: false }, (err) => {
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