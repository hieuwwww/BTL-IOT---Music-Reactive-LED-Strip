# BTL-IOT---Music-Reactive-LED-Strip

Hệ thống đèn LED thông minh phản ứng theo nhạc, điều khiển qua web/app, hỗ trợ mic và WiFi sync.

**Đặc điểm nổi bật**
- Giao diện web đẹp, dark/light mode, responsive
- Độ trễ < 80ms (cùng mạng LAN)
- Hỗ trợ WS2812B / SK6812
- Xử lý âm thanh real-time (mic MAX9814 hoặc analog)
- OTA, lưu cấu hình, tự reconnect
- Dùng MQTT + Socket.IO + React + Node.js

## Cấu trúc thư mục
├── server/          → Backend Node.js + Socket.IO + MQTT bridge
├── web/             → Frontend React + Tailwind
├── firmware/        → Code ESP32 (Arduino IDE)
├── mosquitto.conf   → Config MQTT broker config
└── docker-compose.yml

## Hướng dẫn chạy nhanh (3 phút)

### 1. Chạy MQTT Broker (Mosquitto)
```bash
# Trong thư mục gốc dự án
docker-compose up -d

→ Broker chạy tại:
MQTT: localhost:1883
WebSocket: localhost:9001

cd server
npm install
npm start

cd web
npm install
npm run dev