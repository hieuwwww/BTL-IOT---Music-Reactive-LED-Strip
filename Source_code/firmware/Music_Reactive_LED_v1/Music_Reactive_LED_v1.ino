#include <WiFi.h>
#include <PubSubClient.h>
#include <Adafruit_NeoPixel.h>

// ======================= CONFIG ============================
#define LED_PIN 15
#define NUM_LEDS 74
#define MIC_PIN 34

Adafruit_NeoPixel strip(NUM_LEDS, LED_PIN, NEO_GRB + NEO_KHZ800);

// WiFi + MQTT
const char* ssid = "TP-Link_725E";
const char* pass = "74344789";
const char* mqtt_server = "192.168.0.102";

WiFiClient espClient;
PubSubClient client(espClient);

// ======================= VARIABLES ============================
bool powerState = false;
int brightnessValue = 255;
String mode = "mic";         
String effect = "pulse";     

int colorR = 255, colorG = 0, colorB = 130;

// NEW: Biến lưu trữ dữ liệu âm thanh phân tích từ Web (Chế độ 2)
int bassValue = 0;
int midValue = 0;
int trebleValue = 0;

unsigned long lastLog = 0;        // chống spam log
unsigned long logDelay = 300;     // 300ms/log

// ============================================================
// Helper: Update color
void applyColor(int r, int g, int b) {
  for (int i = 0; i < NUM_LEDS; i++)
    strip.setPixelColor(i, strip.Color(r, g, b));
  strip.show();
}

// ======================= EFFECTS ============================
void effectRainbow() {
  static uint16_t j = 0;

  for (int i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(i,
      strip.gamma32(strip.ColorHSV((i * 65535 / NUM_LEDS) + j))
    );
  }
  strip.show();
  j += 256;

  if (millis() - lastLog > logDelay) {
    Serial.println("[EFFECT] rainbow running...");
    lastLog = millis();
  }
}

void effectFade() {
  static int v = 0;
  static int step = 3;

  v += step;
  if (v >= 255 || v <= 0) step = -step;

  applyColor((colorR * v) / 255, (colorG * v) / 255, (colorB * v) / 255);

  if (millis() - lastLog > logDelay) {
    Serial.print("[EFFECT] fade value = ");
    Serial.println(v);
    lastLog = millis();
  }
}

void effectPulse() {
  static int value = 0;
  static int dir = 5;

  value += dir;
  if (value >= brightnessValue || value <= 10) dir = -dir;

  applyColor((colorR * value) / 255, (colorG * value) / 255, (colorB * value) / 255);

  if (millis() - lastLog > logDelay) {
    Serial.print("[EFFECT] pulse value = ");
    Serial.println(value);
    lastLog = millis();
  }
}

void effectFire() {
  for (int i = 0; i < NUM_LEDS; i++) {
    int flicker = random(120, 255);
    strip.setPixelColor(i, strip.Color(flicker, flicker / 3, 0));
  }
  strip.show();

  if (millis() - lastLog > logDelay) {
    Serial.println("[EFFECT] fire flames...");
    lastLog = millis();
  }
}

// ======================= NEW SYNC EFFECTS (MUSIC REACTIVE) ============================

// Hiệu ứng: Sync Mode - Strobe Bass (Nhấp nháy theo bass)
void effectSyncStrobeBass() {
  // bassValue từ 0-255, kiểm soát tốc độ nhấp nháy
  // Bass to → nhấp nháy nhanh, Bass nhỏ → nhấp nháy chậm
  
  static unsigned long lastStrobe = 0;
  static bool strobeOn = true;
  
  // Map bass thành delay: bass nhỏ (0) = 200ms, bass to (255) = 50ms
  int strobeDelay = map(bassValue, 0, 255, 200, 50);
  
  if (millis() - lastStrobe > strobeDelay) {
    strobeOn = !strobeOn;
    lastStrobe = millis();
  }
  
  if (strobeOn) {
    // Sáng: màu đỏ (bass) từ người dùng chọn
    applyColor(colorR, colorG, colorB);
  } else {
    // Tắt: tối
    applyColor(0, 0, 0);
  }
}

// Hiệu ứng: Sync Mode - Wave Mid (Sóng di chuyển theo mid)
void effectSyncWaveMid() {
  // midValue từ 0-255, kiểm soát tốc độ sóng di chuyển
  static uint16_t wavePos = 0;
  
  // Map mid thành tốc độ: mid nhỏ = chậm (50), mid to = nhanh (300)
  int waveSpeed = map(midValue, 0, 255, 50, 300);
  
  // Tính độ sáng từ mid: 0-255
  int intensity = midValue;
  
  for (int i = 0; i < NUM_LEDS; i++) {
    // Tạo hiệu ứng sóng: độ sáng thay đổi theo vị trí + wavePos
    int brightness = sin((i + wavePos) * 3.14 / NUM_LEDS) * 127 + 128;
    brightness = (brightness * intensity) / 255;
    
    int r = (colorR * brightness) / 255;
    int g = (colorG * brightness) / 255;
    int b = (colorB * brightness) / 255;
    
    strip.setPixelColor(i, strip.Color(r, g, b));
  }
  strip.show();
  
  wavePos += waveSpeed / 100; // Cập nhật vị trí sóng
}

// Hiệu ứng: Sync Mode - Pulse Treble (Nhấp nháy cường độ theo treble)
void effectSyncPulseTreble() {
  // trebleValue từ 0-255, kiểm soát cường độ nhấp nháy
  // Treble to → sáng tối, Treble nhỏ → mờ
  
  static int pulseValue = 0;
  static int pulseDir = 5;
  
  // Tốc độ nhấp nháy: treble nhỏ = chậm (dir=2), treble to = nhanh (dir=10)
  int pulseSpeed = map(trebleValue, 0, 255, 2, 10);
  
  pulseValue += pulseDir * pulseSpeed;
  if (pulseValue >= 255 || pulseValue <= 0) {
    pulseDir = -pulseDir;
  }
  
  // Cường độ phản ứng với treble: treble nhỏ → dim, treble to → sáng
  int finalIntensity = (pulseValue * trebleValue) / 255;
  
  int r = (colorR * finalIntensity) / 255;
  int g = (colorG * finalIntensity) / 255;
  int b = (colorB * finalIntensity) / 255;
  
  applyColor(r, g, b);
}

// ======================= EFFECTS (MIC MODE - SOUND REACTIVE) ============================

// Hiệu ứng Mặc định: Mic Mode Pulse
void effectMicPulse(int v) {
  // v là giá trị âm thanh đã được map (10 -> brightnessValue)
  // Đây là logic cũ của Mic Mode: Độ sáng/Màu thay đổi trực tiếp theo âm thanh
  applyColor((colorR * v) / 255, (colorG * v) / 255, (colorB * v) / 255);
}

// Hiệu ứng: Mic Mode Rainbow (Độ sáng + Tốc độ + Khả năng phản ứng rõ ràng với âm thanh)
void effectMicRainbow(int v) {
  static uint16_t j = 0;
  static int lastV = 0;

  // v là cường độ âm thanh (10 -> brightnessValue)
  // Map tốc độ: v nhỏ = tĩnh (30), v lớn = nhanh (600)
  int speedFactor = map(v, 10, brightnessValue, 30, 600);
  
  // Tính độ sáng: v nhỏ = mờ (50), v lớn = sáng (255)
  int intensity = map(v, 10, brightnessValue, 50, 255);
  
  // Phát hiện đỉnh âm thanh (thay đổi đột ngột): tăng tốc độ xoay khi có đỉnh
  int peakBoost = 0;
  if (v > lastV + 30) { // Phát hiện tăng đột ngột
    peakBoost = 200; // Tăng tốc độ xoay thêm
  }
  lastV = v;

  for (int i = 0; i < NUM_LEDS; i++) {
    uint32_t hsv = strip.ColorHSV((i * 65535 / NUM_LEDS) + j);
    uint32_t rgb = strip.gamma32(hsv);
    
    // Trích xuất RGB từ uint32_t
    uint8_t r = (rgb >> 16) & 0xFF;
    uint8_t g = (rgb >> 8) & 0xFF;
    uint8_t b = rgb & 0xFF;
    
    // Áp dụng intensity (độ sáng) từ cường độ âm thanh
    r = (r * intensity) / 255;
    g = (g * intensity) / 255;
    b = (b * intensity) / 255;
    
    strip.setPixelColor(i, strip.Color(r, g, b));
  }
  strip.show();
  
  // Cập nhật vị trí cầu vồng với tốc độ theo âm thanh
  j += speedFactor + peakBoost;
}

// Hiệu ứng: Mic Mode Fire (Lửa chậm rãi, nhưng độ sáng phản ứng trực tiếp với âm thanh)
void effectMicFire(int v) {
  static unsigned long lastUpdate = 0;
  static int prevV = v;
  
  // Cập nhật chậm rãi mỗi 200ms (độc lập với âm thanh)
  const int fireUpdateDelay = 200;
  
  if (millis() - lastUpdate >= fireUpdateDelay) {
    prevV = v; // Lưu giá trị âm thanh hiện tại
    lastUpdate = millis();
  }
  
  // Sử dụng prevV (giá trị âm thanh được cập nhật chậm) để tạo lửa chậm rãi
  // Nhưng prevV vẫn phản ứng với âm thanh to/nhỏ
  int fireIntensity = map(prevV, 10, brightnessValue, 30, 255); // Phạm vi tối rộng
  
  // Tạo hoạt ảnh lửa: mỗi LED có brightness khác nhau
  for (int i = 0; i < NUM_LEDS; i++) {
    // Thêm biến đổi ngẫu nhiên nhỏ để lửa bập bùng (±20%)
    int variation = random(80, 121); // 80-120% của fireIntensity
    int intensity = (fireIntensity * variation) / 100;
    intensity = min(intensity, 255); // Giới hạn tối đa
    
    // Màu lửa: Đỏ-Cam-Vàng
    int red = intensity;
    int green = (intensity * 40) / 255;  // Cam
    int blue = 0;
    
    strip.setPixelColor(i, strip.Color(red, green, blue));
  }
  strip.show();
}

// ======================= NEW MIC EFFECTS ============================

// Hiệu ứng: Mic Mode Strobe (Nhấp nháy theo nhịp bass)
void effectMicStrobe(int v) {
  static unsigned long lastStrobe = 0;
  static bool strobeOn = true;
  
  // Map v thành tốc độ strobe (v nhỏ = chậm, v lớn = nhanh)
  int strobeDelay = map(v, 10, brightnessValue, 200, 30);
  
  if (millis() - lastStrobe > strobeDelay) {
    strobeOn = !strobeOn;
    lastStrobe = millis();
  }
  
  if (strobeOn) {
    applyColor(colorR, colorG, colorB);
  } else {
    applyColor(0, 0, 0);
  }
}

// Hiệu ứng: Mic Mode Breathing (Thở với 7 màu cầu vồng, nhịp chậm)
void effectMicBreathing(int v) {
  static uint16_t colorIndex = 0;
  static unsigned long lastColorChange = 0;
  static int breathValue = 0;
  static int breathDir = 2;
  
  // Đổi màu cầu vồng mỗi 800ms (nhịp chậm)
  if (millis() - lastColorChange > 800) {
    colorIndex = (colorIndex + 65535 / 7) % 65535; // 7 màu
    lastColorChange = millis();
  }
  
  // v ảnh hưởng tới tốc độ thở: v nhỏ = thở chậm, v lớn = thở nhanh
  int breathSpeed = map(v, 10, brightnessValue, 1, 4);
  
  breathValue += breathDir * breathSpeed;
  if (breathValue >= brightnessValue || breathValue <= 10) {
    breathDir = -breathDir;
  }
  
  // Lấy màu từ cầu vồng
  uint32_t rainbowColor = strip.gamma32(strip.ColorHSV(colorIndex));
  
  // Áp dụng độ sáng thở lên toàn bộ LED
  uint8_t r = ((rainbowColor >> 16) & 0xFF) * breathValue / 255;
  uint8_t g = ((rainbowColor >> 8) & 0xFF) * breathValue / 255;
  uint8_t b = (rainbowColor & 0xFF) * breathValue / 255;
  
  applyColor(r, g, b);
}

// Hiệu ứng: Mic Mode Equalizer (Các thanh LED phản ứng từng vùng tần số)
void effectMicEqualizer(int v) {
  // Chia dải LED thành 3 phần (Bass, Mid, Treble)
  // Mỗi phần phản ứng với một vùng tần số được đọc từ microphone
  
  // v là cường độ tổng hợp, chia thành 3 vùng
  int third = NUM_LEDS / 3;
  
  // Tạo 3 giá trị khác nhau bằng cách thêm biến ngẫu nhiên nhỏ
  int bass_val = map(v, 10, brightnessValue, 50, 255);
  int mid_val = map(v - 20, 10, brightnessValue, 30, 200);  // Lệch khác bass
  int treble_val = map(v + 20, 10, brightnessValue, 20, 180); // Lệch khác mid
  
  // Điều chỉnh bằng brightness
  bass_val = (bass_val > brightnessValue) ? brightnessValue : bass_val;
  mid_val = (mid_val > brightnessValue) ? brightnessValue : mid_val;
  treble_val = (treble_val > brightnessValue) ? brightnessValue : treble_val;
  
  // Bass Zone (Đỏ) - phần 1/3 đầu
  for (int i = 0; i < third; i++) {
    strip.setPixelColor(i, strip.Color(bass_val, 0, 0));
  }
  
  // Mid Zone (Xanh lá) - phần 1/3 giữa
  for (int i = third; i < 2 * third; i++) {
    strip.setPixelColor(i, strip.Color(0, mid_val, 0));
  }
  
  // Treble Zone (Xanh dương) - phần 1/3 cuối
  for (int i = 2 * third; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(0, 0, treble_val));
  }
  
  strip.show();
}

// ======================= NEW EFFECT (CHẾ ĐỘ 2 - MUSIC SYNC) ============================

void effectMusicSync() {
  // Ví dụ: Chiếu sáng 1/3 dải LED theo Bass (Đỏ), 1/3 theo Mid (Xanh lá), 1/3 theo Treble (Xanh dương)
  int third = NUM_LEDS / 3;

  // Đảm bảo giá trị không vượt quá độ sáng Max
  int finalBass = map(bassValue, 0, 255, 0, brightnessValue);
  int finalMid = map(midValue, 0, 255, 0, brightnessValue);
  int finalTreble = map(trebleValue, 0, 255, 0, brightnessValue);


  // Bass Zone (Đỏ)
  for (int i = 0; i < third; i++) {
    strip.setPixelColor(i, strip.Color(finalBass, 0, 0));
  }
  // Mid Zone (Xanh Lá)
  for (int i = third; i < 2 * third; i++) {
    strip.setPixelColor(i, strip.Color(0, finalMid, 0));
  }
  // Treble Zone (Xanh Dương)
  for (int i = 2 * third; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(0, 0, finalTreble));
  }

  strip.show();

  // Logging cho Music Sync mode
  if (millis() - lastLog > 100) { // Log nhanh hơn để kiểm tra dữ liệu real-time
    Serial.printf("[SYNC] B=%d, M=%d, T=%d (Final: %d, %d, %d)\n", bassValue, midValue, trebleValue, finalBass, finalMid, finalTreble);
    lastLog = millis();
  }
}

// ======================= MQTT CALLBACK ============================
void mqttCallback(char* topic, byte* msg, unsigned int length) {
  msg[length] = '\0';
  String payload = String((char*)msg);

  Serial.print("[MQTT] Topic = ");
  Serial.print(topic);
  Serial.print(" | Payload = ");
  Serial.println(payload);

  // NEW: Xử lý dữ liệu âm thanh từ Web App (Chế độ 2)
  if (String(topic) == "led/control/music_data") {
    // Payload format: "BASS,MID,TREBLE" (e.g., "120,50,200")
    int comma1 = payload.indexOf(',');
    int comma2 = payload.lastIndexOf(',');
    
    // Cần kiểm tra xem chuỗi có đúng format không
    if (comma1 > 0 && comma2 > comma1) {
      bassValue = payload.substring(0, comma1).toInt();
      midValue = payload.substring(comma1 + 1, comma2).toInt();
      trebleValue = payload.substring(comma2 + 1).toInt();
    }
    return; 
  }

  if (String(topic) == "led/control/power") {
    powerState = (payload == "on");
    Serial.println(powerState ? "[SYS] Power ON" : "[SYS] Power OFF");
    return;
  }

  if (String(topic) == "led/control/brightness") {
    brightnessValue = payload.toInt();
    strip.setBrightness(brightnessValue);
    Serial.printf("[SYS] Brightness = %d\n", brightnessValue);
    return;
  }

  if (String(topic) == "led/control/color") {
    sscanf(payload.c_str(), "%d,%d,%d", &colorR, &colorG, &colorB);
    Serial.printf("[SYS] New color RGB = %d,%d,%d\n", colorR, colorG, colorB);
    return;
  }

  if (String(topic) == "led/control/mode") {
    mode = payload;
    Serial.printf("[SYS] Mode changed to: %s\n", mode.c_str());
    // Tắt hiển thị nếu chuyển mode từ "sync"
    if (mode != "sync") {
      bassValue = midValue = trebleValue = 0;
    }
    return;
  }

  if (String(topic) == "led/control/effect") {
    effect = payload;
    Serial.printf("[SYS] Effect selected: %s\n", effect.c_str());
    return;
  }
}

// ======================= WIFI + MQTT ============================
void setup() {
  Serial.begin(115200);

  strip.begin();
  strip.show();

  Serial.println("[WIFI] Connecting...");
  WiFi.begin(ssid, pass);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.print("\n[WIFI] Connected! IP: ");
  Serial.println(WiFi.localIP());

  client.setServer(mqtt_server, 1883);
  client.setCallback(mqttCallback);
}


void reconnect() {
  while (!client.connected()) {
    Serial.println("[MQTT] Connecting...");
    if (client.connect("ESP32_LED_DEVICE_1")) {
      Serial.println("[MQTT] Connected OK");
      client.subscribe("led/control/#");
      // FIX: Thêm tham số 'true' để bật cờ Retain (Thông điệp sẽ được lưu trên Broker)
      client.publish("led/status", "ESP32 OK", true); // <-- Đã sửa
    } else {
      Serial.println("[MQTT] Failed. Retry...");
      delay(1000);
    }
  }
}

// ======================= LOOP ============================
void loop() {
  if (!client.connected()) reconnect();
  client.loop();

  if (!powerState) {
    applyColor(0, 0, 0);
    return;
  }
  if (mode == "sync") {
    // Chế độ đồng bộ nhạc - Chọn hiệu ứng dựa trên bass/mid/treble
    if (effect == "fade") effectFade();
    else if (effect == "spectrum") effectMusicSync(); // Mặc định: phân chia bass/mid/treble
    else if (effect == "rainbow") effectRainbow();
    else if (effect == "strobe") effectSyncStrobeBass();    // NEW: Nhấp nháy theo bass
    else if (effect == "wave") effectSyncWaveMid();         // NEW: Sóng di chuyển theo mid
    else if (effect == "pulse") effectSyncPulseTreble();    // NEW: Nhấp nháy cường độ theo treble
    else applyColor(colorR, colorG, colorB);
  }
  else if (mode == "wifi") {
    if (effect == "fade") effectFade();
    else if (effect == "pulse") effectPulse();
    else if (effect == "rainbow") effectRainbow();
    else if (effect == "fire") effectFire();
    else applyColor(colorR, colorG, colorB);
  }

  if (mode == "mic") {
    int mic = analogRead(MIC_PIN);
    // Ánh xạ tín hiệu mic thô (0-4095) thành độ sáng/cường độ (10 -> Brightness Max)
    int v = map(mic, 0, 4095, 10, brightnessValue);

    // Chọn hiệu ứng mic dựa trên biến 'effect' được set từ giao diện
    if (effect == "rainbow") {
      effectMicRainbow(v);
    }
    else if (effect == "fire") {
      effectMicFire(v);
    }
    else if (effect == "strobe") {
      effectMicStrobe(v);
    }
    else if (effect == "breathing") {
      effectMicBreathing(v);
    }
    else if (effect == "equalizer") {
      effectMicEqualizer(v);
    }
    // Mặc định là hiệu ứng Pulse (phản ứng trực tiếp với độ sáng)
    else { 
      effectMicPulse(v);
    }
    // Logging cho Mic mode
    if (millis() - lastLog > 400) {
      Serial.printf("[MIC] mode=%s effect=%s raw=%d mapped=%d\n", mode.c_str(), effect.c_str(), mic, v);
      lastLog = millis();
    }
  }  
}
