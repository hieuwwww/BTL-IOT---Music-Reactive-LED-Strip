#include <WiFi.h>
#include <PubSubClient.h>
#include <FastLED.h>
#include <EEPROM.h>
#include <ArduinoOTA.h>

// ================== CẤU HÌNH ==================
#define NUM_LEDS 300 // Số LED
#define DATA_PIN 18
#define MIC_PIN 34 // Mic analog
#define LED_TYPE WS2812B
#define COLOR_ORDER GRB

const char *ssid = "YOUR_WIFI_SSID";
const char *password = "YOUR_WIFI_PASSWORD";
const char *mqtt_server = "192.168.1.100"; // IP máy chạy Mosquitto (hoặc localhost nếu cùng mạng)

WiFiClient espClient;
PubSubClient client(espClient);
CRGB leds[NUM_LEDS];

// Biến trạng thái
bool power = true;
uint8_t brightness = 255;
String effect = "pulse";
String mode = "mic";
CRGB baseColor = CRGB::Purple;

// =============================================
void setup()
{
  Serial.begin(115200);
  FastLED.addLeds<LED_TYPE, DATA_PIN, COLOR_ORDER>(leds, NUM_LEDS).setCorrection(TypicalLEDStrip);
  FastLED.setBrightness(brightness);
  EEPROM.begin(512);
  loadSettings();

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED)
    delay(500);
  Serial.println("WiFi connected: " + WiFi.localIP().toString());

  client.setServer(mqtt_server, 1883);
  client.setCallback(callback);
  reconnectMQTT();

  ArduinoOTA.begin();
  publishStatus("ESP32 Ready – IP: " + WiFi.localIP().toString());
}

void loop()
{
  if (!client.connected())
    reconnectMQTT();
  client.loop();
  ArduinoOTA.handle();

  if (power)
  {
    if (mode == "mic")
    {
      micReact()
    }
    else if (mode == "wifi")
    {
      // Ví dụ hiệu ứng Spectrum theo bass/mid/treble
      int bassPos = map(bassLevel, 0, 1000, 0, NUM_LEDS / 3);
      int midPos = map(midLevel, 0, 800, NUM_LEDS / 3, 2 * NUM_LEDS / 3);
      int treblePos = map(trebleLevel, 0, 600, 2 * NUM_LEDS / 3, NUM_LEDS);

      fill_solid(leds, NUM_LEDS, CRGB::Black);
      fill_solid(leds, bassPos, CRGB::Red);
      fill_solid(leds + NUM_LEDS / 3, midPos - NUM_LEDS / 3, CRGB::Green);
      fill_solid(leds + 2 * NUM_LEDS / 3, treblePos - 2 * NUM_LEDS / 3, CRGB::Blue);
    };
    else
      staticColor();
  }
  else
  {
    fill_solid(leds, NUM_LEDS, CRGB::Black);
  }
  FastLED.show();
  delay(10);
}

// ================== MQTT Callback ==================================================
void callback(char *topic, byte *payload, unsigned int length)
{
  String message = "";
  for (int i = 0; i < length; i++)
    message += (char)payload[i];

  String t = String(topic);
  if (t == "led/control/power")
  {
    power = (message == "on");
  }
  else if (t == "led/control/brightness")
  {
    brightness = message.toInt();
    FastLED.setBrightness(brightness);
  }
  else if (t == "led/control/color")
  {
    long hex = strtol(message.c_str() + 1, NULL, 16);
    baseColor = CRGB(hex);
  }
  else if (t == "led/control/effect")
  {
    effect = message;
  }
  else if (t == "led/control/mode")
  {
    mode = message;
  }
  else if (t.startsWith("led/audio/"))
  {
    int value = message.toInt();
    if (t == "led/audio/bass")
      bassLevel = value;
    if (t == "led/audio/mid")
      midLevel = value;
    if (t == "led/audio/treble")
      trebleLevel = value;
  }

  saveSettings();
  publishStatus("OK");
}

// ================== Các hàm hiệu ứng ================================
void micReact()
{
  int sample = analogRead(MIC_PIN);
  int level = map(sample, 0, 4095, 0, 255);
  level = constrain(level, 20, 255);

  if (effect == "pulse")
  {
    fill_solid(leds, NUM_LEDS, baseColor);
    FastLED.setBrightness(level);
  }
  else if (effect == "spectrum")
  {
    int pos = map(level, 20, 255, 0, NUM_LEDS);
    fill_rainbow(leds, NUM_LEDS, millis() / 20, 7);
    fill_solid(leds + pos, NUM_LEDS - pos, CRGB::Black);
  }
}

void staticColor()
{
  fill_solid(leds, NUM_LEDS, baseColor);
}

// ================== Helper ===========================================
void reconnectMQTT()
{
  while (!client.connected())
  {
    if (client.connect("ESP32_LED_Client"))
    {
      client.subscribe("led/control/#");
    }
    delay(2000);
  }
}

void publishStatus(String msg)
{
  client.publish("led/status", msg.c_str());
}

void saveSettings()
{
  EEPROM.write(0, power ? 1 : 0);
  EEPROM.write(1, brightness);
  EEPROM.writeString(10, effect);
  EEPROM.writeString(50, mode);
  EEPROM.commit();
}

void loadSettings()
{
  power = EEPROM.read(0);
  brightness = EEPROM.read(1);
  effect = EEPROM.readString(10);
  mode = EEPROM.readString(50);
  FastLED.setBrightness(brightness);
}