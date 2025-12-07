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

// ======================= MQTT CALLBACK ============================
void mqttCallback(char* topic, byte* msg, unsigned int length) {
  msg[length] = '\0';
  String payload = String((char*)msg);

  Serial.print("[MQTT] Topic = ");
  Serial.print(topic);
  Serial.print(" | Payload = ");
  Serial.println(payload);

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

  if (mode == "wifi") {
    if (effect == "fade") effectFade();
    else if (effect == "pulse") effectPulse();
    else if (effect == "rainbow") effectRainbow();
    else if (effect == "fire") effectFire();
    else applyColor(colorR, colorG, colorB);
  }

  if (mode == "mic") {
    int mic = analogRead(MIC_PIN);
    int v = map(mic, 0, 4095, 10, brightnessValue);

    applyColor((colorR * v) / 255, (colorG * v) / 255, (colorB * v) / 255);

    if (millis() - lastLog > 400) {
      Serial.printf("[MIC] raw=%d mapped=%d\n", mic, v);
      lastLog = millis();
    }
  }
}
