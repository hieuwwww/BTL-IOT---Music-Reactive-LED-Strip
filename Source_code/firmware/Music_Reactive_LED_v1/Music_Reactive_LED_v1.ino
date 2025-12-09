#include <WiFi.h>
#include <PubSubClient.h>
#include <Adafruit_NeoPixel.h>
#include <WiFiManager.h>
#include <HTTPClient.h>           
#include <Preferences.h>
// ======================= CẤU HÌNH CLOUD =======================
#define CLOUD_SERVER_HOST "192.168.0.112"   // IP server Node.js của bạn
#define CLOUD_SERVER_PORT 3000             // Port Express

// ======================= CONFIG ============================
#define LED_PIN     15
#define NUM_LEDS    74
#define MIC_PIN     34

Adafruit_NeoPixel strip(NUM_LEDS, LED_PIN, NEO_GRB + NEO_KHZ800);

Preferences prefs;
WiFiManager wm;

String deviceId, deviceName;
String firmwareVersion = "1.0.0";

const char* mqtt_server = "192.168.0.112";  // MQTT Broker (cùng server)

WiFiClient espClient;
PubSubClient client(espClient);

// ======================= VARIABLES ============================
bool powerState = false;
int micCenter = 1700;      // backup
bool micCalibrated = false;

void calibrateMic() {
  long sum = 0;
  for (int i = 0; i < 500; i++) {
    sum += analogRead(MIC_PIN);
    delay(2);
  }
  micCenter = sum / 500;

  Serial.print("[MIC] Auto bias center = ");
  Serial.println(micCenter);

  micCalibrated = true;
}


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
unsigned long lastMusicReceived = 0;            // thời điểm nhận music_data lần cuối
const unsigned long MUSIC_TIMEOUT = 700;        // ms -> nếu quá thời gian này, coi là idle
bool syncIdle = true;                           // trạng thái hiện tại
const int ENERGY_THRESHOLD_ACTIVE = 20; 

// ======================= HELPERS ============================
String makeDeviceIdFromMac() {
  uint64_t mac = ESP.getEfuseMac();
  uint8_t b[6];
  for (int i = 0; i < 6; ++i) b[i] = (mac >> (8*(5-i))) & 0xFF;
  char buf[24];
  sprintf(buf, "DVC-%02X%02X%02X%02X", b[2], b[3], b[4], b[5]);
  return String(buf);
}

bool registerToCloud() {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String url = "http://" + String(CLOUD_SERVER_HOST) + ":" + String(CLOUD_SERVER_PORT) + "/api/devices/register";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  String payload = "{\"deviceId\":\"" + deviceId +
                   "\",\"deviceName\":\"" + deviceName +
                   "\",\"firmware\":\"" + firmwareVersion + "\"}";

  int httpCode = http.POST(payload);
  String response = http.getString();
  http.end();

  Serial.printf("[REGISTER] %d - %s\n", httpCode, response.c_str());

  return (httpCode >= 200 && httpCode < 300);
}

void updateSyncIdle() {
  // 1) Nếu dữ liệu quá cũ thì coi là idle ngay
  if (millis() - lastMusicReceived > MUSIC_TIMEOUT) {
    if (!syncIdle) {
      // trạng thái thay đổi -> log nhẹ
      Serial.println("[SYNC] -> IDLE (no recent music data)");
    }
    syncIdle = true;
    return;
  }

  // 2) Dữ liệu còn mới -> kiểm tra energy
  int energy = (bassValue + midValue + trebleValue) / 3;

  // Hysteresis nhẹ: chỉ bật active khi energy > threshold
  if (energy > ENERGY_THRESHOLD_ACTIVE) {
    if (syncIdle) {
      Serial.println("[SYNC] -> ACTIVE (music detected)");
    }
    syncIdle = false;
  } else {
    // Nếu dữ liệu mới nhưng energy thấp, vẫn có thể coi là idle
    // Tuy nhiên do thời gian còn mới (lastMusicReceived recent), giữ syncIdle = true
    // hoặc bạn muốn cho phép brief silence -> dùng threshold thời gian thay vì trực tiếp set idle
    if (!syncIdle) {
      Serial.println("[SYNC] -> IDLE (energy low)");
    }
    syncIdle = true;
  }
}

// computeReactivity: trả về hệ số 0.15 .. 1.0 (idle ~0.15)
float computeReactivity(int v, int thresholdLow = 30) {
  float minR = 0.15f; // độ "í­t" của idle
  // Serial.print("[Mic Reactivity] ...");
  // Serial.println(v);
  
  if (v <= thresholdLow) return minR;
  float r = (float)v / (float)brightnessValue; // v được map tới 10..brightnessValue
  r = constrain(r, minR, 1.0f);
  return r;
}

// computeReactivitySync: dùng cho sync mode (dựa trên trung bình B/M/T)
float computeReactivitySync(int b, int m, int t) {
  float minR = 0.15f;
  int energy = (b + m + t) / 3;
  Serial.print("[Sync Reactivity] ...");
  Serial.println(energy);
  if (energy <= 20) return minR;
  float r = (float)energy / 255.0f;
  r = constrain(r, minR, 1.0f);
  return r;
}

// Helper: Update color (giữ nguyên)
void applyColor(int r, int g, int b) {
  for (int i = 0; i < NUM_LEDS; i++)
    strip.setPixelColor(i, strip.Color(r, g, b));
  strip.show();
}

// Helper: map a mic-mapped value v (10..brightnessValue) -> 10..255 (for color math)
int normTo255(int v) {
  return constrain(map(v, 10, brightnessValue, 10, 255), 10, 255);
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
    // Serial.print("[EFFECT] pulse value = ");
    // Serial.println(value);
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
  static unsigned long lastStrobe = 0;
  static bool strobeOn = true;

  int baseDelay = map(bassValue, 0, 255, 200, 50); // base
  float react = computeReactivitySync(bassValue, midValue, trebleValue);

  // Khi idle (react nhỏ) -> kéo dài delay về phía 200ms
  int strobeDelay = baseDelay + (int)((200 - baseDelay) * (1.0f - react));
  strobeDelay = max(20, strobeDelay);

  if (millis() - lastStrobe > (unsigned long)strobeDelay) {
    strobeOn = !strobeOn;
    lastStrobe = millis();
  }

  if (strobeOn) {
    applyColor(colorR, colorG, colorB);
  } else {
    applyColor(0, 0, 0);
  }
}

// Hiệu ứng: Sync Mode - Wave Mid (Sóng di chuyển theo mid)
void effectSyncWaveMid() {
  static uint16_t wavePos = 0;

  int waveSpeedBase = map(midValue, 0, 255, 50, 300);
  float react = computeReactivitySync(bassValue, midValue, trebleValue);
  // Idle: làm chậm về ~20% tốc độ, Nhạc mạnh: sử dụng full tốc độ
  float speedMul = 0.2f + 0.8f * react;
  int waveSpeed = max(1, (int)(waveSpeedBase * speedMul));

  int intensity = midValue; // 0-255

  for (int i = 0; i < NUM_LEDS; i++) {
    int brightness = sin((i + wavePos) * 3.14159 / NUM_LEDS) * 127 + 128;
    brightness = (brightness * intensity) / 255;

    int r = (colorR * brightness) / 255;
    int g = (colorG * brightness) / 255;
    int b = (colorB * brightness) / 255;

    strip.setPixelColor(i, strip.Color(r, g, b));
  }
  strip.show();

  wavePos += max(1, waveSpeed / 20); // làm chậm cập nhật vị trí cho ổn định
}

// Hiệu ứng: Sync Mode - Pulse Treble (Nhấp nháy cường độ theo treble)
void effectSyncPulseTreble() {
  static int pulseValue = 0;
  static int pulseDir = 5;

  int pulseSpeedBase = map(trebleValue, 0, 255, 2, 10);
  float react = computeReactivitySync(bassValue, midValue, trebleValue);
  float speedMul = 0.2f + 0.8f * react;
  int pulseSpeed = max(1, (int)(pulseSpeedBase * speedMul));

  pulseValue += pulseDir * pulseSpeed;
  if (pulseValue >= 255 || pulseValue <= 0) {
    pulseDir = -pulseDir;
  }

  int finalIntensity = (pulseValue * trebleValue) / 255;

  int r = (colorR * finalIntensity) / 255;
  int g = (colorG * finalIntensity) / 255;
  int b = (colorB * finalIntensity) / 255;

  applyColor(r, g, b);
}

// ======================= EFFECTS (MIC MODE - SOUND REACTIVE) ============================

// Hiệu ứng Mặc định: Mic Mode Pulse (đã bổ sung reactivity)
void effectMicPulse(int v) {
  // chuẩn hoá v -> 10..255
  int nv = normTo255(v);
  float react = computeReactivity(v);

  // Tăng/giảm amplitude theo react; idle ~ 20% amplitude, nhạc mạnh ~ full
  float ampMul = 0.2f + 0.8f * react;
  int intensity = max(10, (int)(nv * ampMul)); // 0..255

  applyColor((colorR * intensity) / 255,
             (colorG * intensity) / 255,
             (colorB * intensity) / 255);
}

// Hiệu ứng: Mic Mode Rainbow (Độ sáng + Tốc độ + Phản ứng rõ ràng)
void effectMicRainbow(int v) {
  static uint16_t j = 0;
  static int lastV = 0;

  int nv = normTo255(v);
  float react = computeReactivity(v);

  int speedFactor = 30 + (int)(react * (600 - 30)); // idle chậm (≈30), nhạc nhanh (≈600)
  int intensity = map(nv, 10, 255, 50, 255);
  intensity = max(10, (int)(intensity * (0.2f + 0.8f * react)));

  int peakBoost = 0;
  if (v > lastV + 30) {
    peakBoost = (int)(200 * react); // chỉ boost khi có peak, scale theo react
  }
  lastV = v;

  for (int i = 0; i < NUM_LEDS; i++) {
    uint32_t hsv = strip.ColorHSV((i * 65535 / NUM_LEDS) + j);
    uint32_t rgb = strip.gamma32(hsv);

    uint8_t r = (rgb >> 16) & 0xFF;
    uint8_t g = (rgb >> 8) & 0xFF;
    uint8_t b = rgb & 0xFF;

    r = (r * intensity) / 255;
    g = (g * intensity) / 255;
    b = (b * intensity) / 255;

    strip.setPixelColor(i, strip.Color(r, g, b));
  }
  strip.show();

  j += speedFactor + peakBoost;
}

// Hiệu ứng: Mic Mode Fire (Lửa chậm rãi, nhưng độ sáng phản ứng trực tiếp)
void effectMicFire(int v) {
  static unsigned long lastUpdate = 0;
  static int prevV = v;

  const int fireUpdateDelay = 200;

  if (millis() - lastUpdate >= fireUpdateDelay) {
    prevV = v;
    lastUpdate = millis();
  }

  float react = computeReactivity(prevV);
  int fireIntensity = map(normTo255(prevV), 10, 255, 30, 255);
  // scale theo react: idle ~ 20% intensity
  fireIntensity = max(10, (int)(fireIntensity * (0.2f + 0.8f * react)));

  for (int i = 0; i < NUM_LEDS; i++) {
    int variation = random(80, 121); // 80-120%
    int intensity = (fireIntensity * variation) / 100;
    intensity = min(intensity, 255);

    int red = intensity;
    int green = (intensity * 40) / 255;
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

  int baseDelay = map(v, 10, brightnessValue, 200, 30);
  float react = computeReactivity(v);
  int strobeDelay = baseDelay + (int)((200 - baseDelay) * (1.0f - react));
  strobeDelay = max(20, strobeDelay);

  if (millis() - lastStrobe > (unsigned long)strobeDelay) {
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

  if (millis() - lastColorChange > 800) {
    colorIndex = (colorIndex + 65535 / 7) % 65535; // 7 màu
    lastColorChange = millis();
  }

  float react = computeReactivity(v);
  int breathSpeed = max(1, (int)( (0.2f + 0.8f * react) * 4 )); // từ 1..4

  breathValue += breathDir * breathSpeed;
  if (breathValue >= brightnessValue || breathValue <= 10) {
    breathDir = -breathDir;
  }

  uint32_t rainbowColor = strip.gamma32(strip.ColorHSV(colorIndex));

  uint8_t r = ((rainbowColor >> 16) & 0xFF) * breathValue / 255;
  uint8_t g = ((rainbowColor >> 8) & 0xFF) * breathValue / 255;
  uint8_t b = (rainbowColor & 0xFF) * breathValue / 255;

  applyColor(r, g, b);
}

// Hiệu ứng: Mic Mode Equalizer (Các thanh LED phản ứng từng vùng tần số)
void effectMicEqualizer(int v) {
  int third = NUM_LEDS / 3;

  // Sử dụng v để làm base; thêm sự khác biệt nhỏ cho mid/treble
  int bass_val = map(v, 10, brightnessValue, 50, 255);
  int mid_val = map(v - 20, 10, brightnessValue, 30, 200);
  int treble_val = map(v + 20, 10, brightnessValue, 20, 180);

  float react = computeReactivity(v);
  float mul = 0.2f + 0.8f * react;

  bass_val = min(brightnessValue, (int)(bass_val * mul));
  mid_val = min(brightnessValue, (int)(mid_val * mul));
  treble_val = min(brightnessValue, (int)(treble_val * mul));

  for (int i = 0; i < third; i++) {
    strip.setPixelColor(i, strip.Color(bass_val, 0, 0));
  }
  for (int i = third; i < 2 * third; i++) {
    strip.setPixelColor(i, strip.Color(0, mid_val, 0));
  }
  for (int i = 2 * third; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(0, 0, treble_val));
  }

  strip.show();
}

// ======================= NEW EFFECT (CHẾ ĐỘ 2 - MUSIC SYNC) ============================
void effectMusicSync() {
  int third = NUM_LEDS / 3;

  float react = computeReactivitySync(bassValue, midValue, trebleValue);

  // Scale each band by react, đảm bảo có brightness nhỏ khi idle
  int finalBass = max(10, (int)(map(bassValue, 0, 255, 0, brightnessValue) * (0.2f + 0.8f * react)));
  int finalMid = max(10, (int)(map(midValue, 0, 255, 0, brightnessValue) * (0.2f + 0.8f * react)));
  int finalTreble = max(10, (int)(map(trebleValue, 0, 255, 0, brightnessValue) * (0.2f + 0.8f * react)));

  for (int i = 0; i < third; i++) {
    strip.setPixelColor(i, strip.Color(finalBass, 0, 0));
  }
  for (int i = third; i < 2 * third; i++) {
    strip.setPixelColor(i, strip.Color(0, finalMid, 0));
  }
  for (int i = 2 * third; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(0, 0, finalTreble));
  }

  strip.show();

  if (millis() - lastLog > 100) {
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

  if (String(topic) == "led/control/music_data") {
    int comma1 = payload.indexOf(',');
    int comma2 = payload.lastIndexOf(',');
    if (comma1 > 0 && comma2 > comma1) {
      bassValue = payload.substring(0, comma1).toInt();
      midValue = payload.substring(comma1 + 1, comma2).toInt();
      trebleValue = payload.substring(comma2 + 1).toInt();
    }
    lastMusicReceived = millis();
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
  strip.setBrightness(255);
  strip.show();

  // Load deviceId
  prefs.begin("meta", true);
  deviceId = prefs.getString("deviceId", "");
  deviceName = prefs.getString("deviceName", "");
  prefs.end();

  if (deviceId == "") {
    deviceId = makeDeviceIdFromMac();
    deviceName = "LED Nhạc " + deviceId.substring(4);
    
    prefs.begin("meta", false);
    prefs.putString("deviceId", deviceId);
    prefs.putString("deviceName", deviceName);
    prefs.end();
  }

  Serial.println("=== LED NHẠC BOOT ===");
  Serial.println("Device ID: " + deviceId);
  Serial.println("Device Name: " + deviceName);

  // WiFiManager – cái này lo hết config WiFi
  wm.setSaveConfigCallback(saveCallback);
  wm.setConfigPortalTimeout(180);
  wm.setTitle("LED Nhạc - Cấu hình WiFi");

  WiFiManagerParameter custom_name("name", "Tên đèn", deviceName.c_str(), 32);
  wm.addParameter(&custom_name);

  String apName = "LED-Nhac-" + deviceId;
  if (!wm.autoConnect(apName.c_str())) {
    Serial.println("Không kết nối được WiFi → Reset");
    ESP.restart();
  }

  // Lưu tên mới nếu người dùng đổi
  String newName = custom_name.getValue();
  if (newName.length() > 0 && newName != deviceName) {
    deviceName = newName;
    prefs.begin("meta", false);
    prefs.putString("deviceName", deviceName);
    prefs.end();
  }

  Serial.println("WiFi OK! IP: " + WiFi.localIP().toString());

  // Đăng ký lên server
  if (registerToCloud()) {
    Serial.println("Đăng ký thành công!");
  } else {
    Serial.println("Đăng ký thất bại, vẫn chạy local được");
  }

  // MQTT
  client.setServer(mqtt_server, 1883);
  client.setCallback(mqttCallback);

  calibrateMic();
}


void saveCallback() {
  Serial.println("[WiFiManager] WiFi đã lưu → Restart...");
  delay(1000);
  ESP.restart();
}

// ======================= MQTT RECONNECT =======================
void reconnectMQTT() {
  int retry = 0;
  while (!client.connected() && retry < 10) {
    Serial.print("[MQTT] Đang kết nối...");
    String clientId = "ESP32_" + deviceId;  // DUY NHẤT CHO TỪNG ĐÈN
    
    if (client.connect(clientId.c_str())) {
      Serial.println("OK");
      
      // Báo online ngay khi kết nối thành công
      client.publish("led/status/online", 
        ("{\"deviceId\":\"" + deviceId + "\",\"ip\":\"" + WiFi.localIP().toString() + "\"}").c_str());

      client.subscribe("led/control/#");
      
    } else {
      Serial.print("thất bại, rc=");
      Serial.print(client.state());
      Serial.println(" thử lại sau 3s");
      delay(3000);
      retry++;
    }
  }
}
// ======================= LOOP ============================
void loop() {
  if (!client.connected()) {
    reconnectMQTT();
  }
  client.loop();

  if (!powerState) {
    applyColor(0, 0, 0);
    return;
  }

  if (mode == "sync") {
    updateSyncIdle();

    // Log idle state nhẹ để tránh spam
    if (millis() - lastLog > 500) {
      Serial.printf("[SYNC] idle=%d  B=%d M=%d T=%d\n", syncIdle, bassValue, midValue, trebleValue);
      lastLog = millis();
    }

    // Nếu IDLE → chạy hiệu ứng idle (tự chọn)
    if (syncIdle) {
        applyColor(10, 10, 10);   // ánh sáng nhẹ khi idle
        return;
    }

    if (effect == "fade") effectFade();
    else if (effect == "spectrum") effectMusicSync();
    else if (effect == "rainbow") effectRainbow();
    else if (effect == "strobe") effectSyncStrobeBass();
    else if (effect == "wave") effectSyncWaveMid();
    else if (effect == "pulse") effectSyncPulseTreble();
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

    // Tính biên độ thực
    int amplitude = abs(mic - micCenter);

    // Giới hạn để không nhảy lung tung
    amplitude = constrain(amplitude, 0, 1500);

    // Scale sang 0–brightnessValue
    int v = map(amplitude, 0, 1500, 0, brightnessValue);

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
    else {
      effectMicPulse(v);
    }

    if (millis() - lastLog > 400) {
      Serial.printf("[MIC] mode=%s effect=%s raw=%d mapped=%d\n", mode.c_str(), effect.c_str(), mic, v);
      lastLog = millis();
    }
  }
}
