// server/index.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mqtt = require('mqtt');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Kết nối tới Mosquitto (cùng máy)
const mqttClient = mqtt.connect('mqtt://localhost:1883');

const topics = [
  'led/control/#',
  'led/status',
  'led/config/save'
];

mqttClient.on('connect', () => {
  console.log('MQTT Broker kết nối OK');
  topics.forEach(t => mqttClient.subscribe(t, () => console.log('Subscribed:', t)));
});

mqttClient.on('message', (topic, message) => {
  const payload = message.toString();
  console.log('MQTT → Web:', topic, payload);
  io.emit('mqtt', { topic, payload }); // gửi toàn bộ web đang mở
});

// Socket.IO: web điều khiển → gửi lệnh tới ESP32
io.on('connection', (socket) => {
  console.log('Web kết nối:', socket.id);

  socket.on('control', (data) => {
    const { topic, payload } = data;
    console.log('Web → ESP32:', topic, payload);
    mqttClient.publish(topic, payload);
  });
});

app.get('/', (req, res) => res.send('Music Reactive LED Server Running!'));

server.listen(3000, () => console.log('Server chạy tại http://localhost:3000'));