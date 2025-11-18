import { useEffect, useState } from "react";
import io from "socket.io-client";
import { HexColorPicker } from "react-colorful";
import { Sun, Moon } from "lucide-react";

const socket = io("http://localhost:3000");

function App() {
  const [power, setPower] = useState(false);
  const [brightness, setBrightness] = useState(255);
  const [color, setColor] = useState("#8b5cf6");
  const [effect, setEffect] = useState("pulse");
  const [mode, setMode] = useState("mic");
  const [status, setStatus] = useState("Đang kết nối...");
  const [darkMode, setDarkMode] = useState(true);

  const send = (topic, payload) => {
    socket.emit("control", { topic: `led/control/${topic}`, payload });
  };

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    document.documentElement.classList.toggle("light", !darkMode);
  }, [darkMode]);

  useEffect(() => {
    socket.on("mqtt", ({ topic, payload }) => {
      if (topic === "led/status") setStatus(payload);
      if (topic === "led/control/power") setPower(payload === "on");
    });
    return () => socket.off("mqtt");
  }, []);

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
                onChange={(e) => {
                  setBrightness(e.target.value);
                  send("brightness", e.target.value);
                }}
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
                Màu nền
              </h2>
              <div className="flex justify-center">
                <HexColorPicker
                  color={color}
                  onChange={(c) => {
                    setColor(c);
                    send("color", c);
                  }}
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
                Microphone
              </button>
              <button
                onClick={() => {
                  setMode("wifi");
                  send("mode", "wifi");
                }}
                className={`py-8 rounded-3xl text-2xl font-bold transition-all transform hover:scale-105 shadow-xl
      ${mode === "wifi" ? "btn-active" : "btn-inactive"}`}
              >
                WiFi Sync
              </button>
            </div>

            {/* Hiệu ứng */}
            <div className="space-y-4">
              {["pulse", "spectrum", "fade", "rainbow", "fire"].map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    setEffect(e);
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
