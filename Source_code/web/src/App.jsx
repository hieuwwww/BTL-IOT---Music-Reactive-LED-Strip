import { useEffect, useState } from "react";
import io from "socket.io-client";
import { HexColorPicker } from "react-colorful";
import { Sun, Moon } from "lucide-react";

// Kết nối tới Node.js Server Bridge (http://localhost:3000)
const socket = io("http://localhost:3000");

// --- HÀM CHUYỂN ĐỔI HEX SANG RGB (R,G,B) ---
const hexToRgbString = (hex) => {
  if (!hex || hex.length !== 7) return "255,0,255"; // Màu mặc định (Magenta)
  const r = parseInt(hex.substring(1, 3), 16);
  const g = parseInt(hex.substring(3, 5), 16);
  const b = parseInt(hex.substring(5, 7), 16);
  return `${r},${g},${b}`;
};

function App() {
  const [power, setPower] = useState(false);
  const [brightness, setBrightness] = useState(255);
  const [color, setColor] = useState("#8b5cf6");
  const [effect, setEffect] = useState("pulse");
  const [mode, setMode] = useState("mic");
  const [status, setStatus] = useState("Đang kết nối...");
  const [darkMode, setDarkMode] = useState(true);

  // Hàm gửi lệnh qua Socket.IO tới Node.js Server
  const send = (topic, payload) => {
    // Topic: led/control/power, led/control/brightness, v.v.
    socket.emit("control", { topic: `led/control/${topic}`, payload });
  };

  // Áp dụng Dark/Light Mode
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    document.documentElement.classList.toggle("light", !darkMode);
  }, [darkMode]);

  // Lắng nghe trạng thái từ Node.js Server (mà Server nhận từ MQTT/ESP32)
  useEffect(() => {
    socket.on("mqtt", ({ topic, payload }) => {
      // Phản hồi trạng thái ESP32
      if (topic === "led/status") setStatus(payload);
      // Phản hồi trạng thái nguồn (nếu ESP32 gửi lại)
      if (topic === "led/control/power") setPower(payload === "on");
    });
    return () => socket.off("mqtt");
  }, []);

  // Hàm xử lý khi thay đổi màu
  const handleColorChange = (newColor) => {
    setColor(newColor);
    // Gửi màu dưới dạng R,G,B (BẮT BUỘC)
    send("color", hexToRgbString(newColor));
    console.log(hexToRgbString(newColor));
    console.log(newColor);

    // Tự động chuyển sang chế độ Manual/Wifi khi chọn màu
    if (mode !== "wifi") {
        setMode("wifi");
        send("mode", "wifi");
    }
  }

  // Hàm xử lý khi thay đổi độ sáng
  const handleBrightnessChange = (e) => {
    const newBrightness = e.target.value;
    setBrightness(newBrightness);
    send("brightness", newBrightness);
    // Tự động chuyển sang chế độ Manual/Wifi
    if (mode !== "wifi") {
        setMode("wifi");
        send("mode", "wifi");
    }
  }

  // CSS Styles (giữ nguyên để hỗ trợ Tailwind CSS)
  return (
    <div
      className={`min-h-screen transition-all duration-300 ${
        darkMode ? "dark" : "light"
      }`}
    >
      <div
        className="min-h-screen p-4 md:p-8"
        style={{ background: "var(--bg)" }}
      >
        {/* Header + Dark mode toggle */}
        <div className="max-w-6xl mx-auto flex justify-between items-center mb-10">
          <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">
            Music Reactive LED
          </h1>
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="p-4 rounded-2xl bg-var-card hover:scale-110 transition-all duration-300 shadow-xl"
            style={{
              background: "var(--card)",
              boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
            }}
          >
            {darkMode ? (
              <Sun size={28} style={{ color: "#fbbf24" }} />
            ) : (
              <Moon size={28} style={{ color: "#6366f1" }} />
            )}
          </button>
        </div>

        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Cột trái */}
          <div className="space-y-8">
            {/* Power */}
            <div
              className="p-8 rounded-3xl shadow-2xl"
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
              }}
            >
              <h2
                className="text-3xl font-bold mb-6"
                style={{ color: "var(--text)" }}
              >
                Power
              </h2>
              <button
                onClick={() => {
                  setPower(!power);
                  send("power", !power ? "on" : "off");
                }}
                className={`w-full py-10 rounded-3xl text-4xl font-bold transition-all duration-500 transform hover:scale-105 shadow-xl
                  ${
                    power
                      ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white"
                      : "bg-gray-800 text-gray-500"
                  }`}
              >
                {power ? "ON" : "OFF"}
              </button>
            </div>

            {/* Độ sáng */}
            <div
              className="p-8 rounded-3xl shadow-2xl"
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
              }}
            >
              <h2
                className="text-2xl font-semibold mb-6"
                style={{ color: "var(--text)" }}
              >
                Độ sáng:{" "}
                <span className="text-3xl font-bold text-purple-500">
                  {brightness}
                </span>
              </h2>
              <input
                type="range"
                min="0"
                max="255"
                value={brightness}
                onChange={handleBrightnessChange} // Dùng hàm mới
                className="w-full h-4 rounded-full slider"
                style={{
                  background: `linear-gradient(to right, #8b5cf6 ${
                    brightness / 2.55
                  }%, #374151 ${brightness / 2.55}%)`,
                  accentColor: "#8b5cf6",
                }}
              />
            </div>

            {/* Chọn màu */}
            <div
              className="p-8 rounded-3xl shadow-2xl"
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
              }}
            >
              <h2
                className="text-2xl font-semibold mb-6"
                style={{ color: "var(--text)" }}
              >
                Màu nền (Chế độ thủ công)
              </h2>
              <div className="flex justify-center">
                <HexColorPicker
                  color={color}
                  onChange={handleColorChange} // Dùng hàm mới
                />
              </div>
            </div>
          </div>

          {/* Cột phải */}
          <div className="space-y-8">
            {/* Chế độ */}
            <div className="grid grid-cols-2 gap-6">
              <button
                onClick={() => {
                  setMode("mic");
                  send("mode", "mic");
                }}
                className={`py-8 rounded-3xl text-2xl font-bold transition-all transform hover:scale-105 shadow-xl
      ${mode === "mic" ? "btn-active" : "btn-inactive"}`}
              >
                Microphone Mode
              </button>
              <button
                onClick={() => {
                  setMode("wifi");
                  send("mode", "wifi");
                }}
                className={`py-8 rounded-3xl text-2xl font-bold transition-all transform hover:scale-105 shadow-xl
      ${mode === "wifi" ? "btn-active" : "btn-inactive"}`}
              >
                Manual Control (WiFi Sync)
              </button>
            </div>

            {/* Hiệu ứng */}
            <div className="space-y-4">
              {["pulse", "spectrum", "fade", "rainbow", "fire"].map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    setEffect(e);
                    // BẮT BUỘC: Phải chuyển sang chế độ Manual/Wifi khi chọn hiệu ứng
                    setMode("wifi"); 
                    send("mode", "wifi");
                    send("effect", e);
                  }}
                  className={`block w-full text-left px-8 py-6 rounded-2xl text-xl font-medium capitalize transition-all transform hover:scale-105
        ${effect === e ? "btn-active" : "btn-inactive"}`}
                >
                  {e === "pulse" && "Nhịp điệu"}
                  {e === "spectrum" && "Phổ tần số"}
                  {e === "fade" && "Chuyển màu mượt"}
                  {e === "rainbow" && "Cầu vồng"}
                  {e === "fire" && "Lửa"}
                  {!["pulse", "spectrum", "fade", "rainbow", "fire"].includes(
                    e
                  ) && e}
                </button>
              ))}
            </div>

            {/* Trạng thái */}
            <div
              className="p-8 rounded-3xl shadow-2xl text-center"
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
              }}
            >
              <p
                className="text-lg opacity-70"
                style={{ color: "var(--text-muted)" }}
              >
                Trạng thái ESP32
              </p>
              <p
                className="text-3xl mt-4 font-mono tracking-wider"
                style={{ color: status.includes("OK") ? "#10b981" : "#ef4444" }}
              >
                {status}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;