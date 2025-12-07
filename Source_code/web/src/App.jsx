import { useEffect, useState, useRef } from "react";
import io from "socket.io-client";
import { HexColorPicker } from "react-colorful";
// CẬP NHẬT: Thêm các Icons điều khiển nhạc
import { Sun, Moon, Play, Pause, Repeat2, SkipForward, Trash2 } from "lucide-react"; 

// Server base URL - thay đổi nếu server chạy trên máy khác
const SERVER_BASE_URL = "http://localhost:3000";
const API_BASE_URL = `${SERVER_BASE_URL}/api`;

// Kết nối tới Node.js Server Bridge
const socket = io(SERVER_BASE_URL);

console.log('[INFO] Connecting to server at:', SERVER_BASE_URL);
socket.on('connect', () => {
  console.log('[✓] Socket.IO connected:', socket.id);
});
socket.on('connect_error', (error) => {
  console.error('[❌] Socket.IO connection error:', error);
});

// --- KHAI BÁO BIẾN CHO WEB AUDIO API (Global hoặc Ref) ---
let audioContext = null;
let analyser = null;
let source = null;
let dataArray = null;
let bufferLength = null;
let animationFrameId = null;

// Tần số cắt (Cutoff Frequencies) để phân chia Bass, Mid, Treble
const BASS_CUTOFF = 250; // Dưới 250Hz là Bass
const MID_CUTOFF = 2000; // Từ 250Hz đến 2000Hz là Mid

// Mode-specific effects mapping
const EFFECTS_BY_MODE = {
  mic: ['pulse', 'rainbow', 'fire', 'strobe', 'breathing', 'equalizer'],
  sync: ['spectrum', 'fade', 'rainbow', 'strobe', 'wave', 'pulse']
};

const EFFECT_LABELS = {
  pulse: 'Nhịp điệu',
  spectrum: 'Phổ tần số',
  fade: 'Chuyển màu mượt',
  rainbow: 'Cầu vồng',
  fire: 'Lửa',
  strobe: 'Nhấp nháy',
  breathing: 'Thở',
  equalizer: 'Bộ sưu tập âm',
  wave: 'Sóng trung tần'
};

// --- HÀM CHUYỂN ĐỔI HEX SANG RGB (R,G,B) ---
const hexToRgbString = (hex) => {
  if (!hex || hex.length !== 7) return "255,0,255"; // Màu mặc định (Magenta)
  const r = parseInt(hex.substring(1, 3), 16);
  const g = parseInt(hex.substring(3, 5), 16);
  const b = parseInt(hex.substring(5, 7), 16);
  return `${r},${g},${b}`;
};

function App() {
  const [_power, _setPower] = useState(false);
  const [brightness, setBrightness] = useState(255);
  const [color, setColor] = useState("#8b5cf6");
  const [effect, setEffect] = useState("pulse");
  const [mode, setMode] = useState("mic");
  const [status, setStatus] = useState("Đang kết nối...");
  const [darkMode, setDarkMode] = useState(true);
  // NEW: State cho Music Sync Mode
  const [savedSongs, setSavedSongs] = useState([]);
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef(null); // Ref để tham chiếu đến thẻ <audio>
  const [playbackRate, setPlaybackRate] = useState(1);
  // Mode-specific effects
  const [micEffect, setMicEffect] = useState("pulse");
  const [syncEffect, setSyncEffect] = useState("fade");

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

  // Auto-switch effect when mode changes
  useEffect(() => {
    if (mode === 'mic') {
      setEffect(micEffect);
      send('effect', micEffect);
    } else if (mode === 'sync') {
      setEffect(syncEffect);
      send('effect', syncEffect);
    }
  }, [mode, micEffect, syncEffect]);

  // Lắng nghe trạng thái từ Node.js Server (mà Server nhận từ MQTT/ESP32)
  useEffect(() => {
    socket.on("mqtt", ({ topic, payload }) => {
      // Phản hồi trạng thái ESP32
      if (topic === "led/status") setStatus(payload);
      // Phản hồi trạng thái nguồn (nếu ESP32 gửi lại)
      if (topic === "led/control/power") _setPower(payload === "on");
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
  }

  // Hàm xử lý khi thay đổi độ sáng
  const handleBrightnessChange = (e) => {
    const newBrightness = e.target.value;
    setBrightness(newBrightness);
    send("brightness", newBrightness);
  }

  // --- NEW: LẤY DANH SÁCH NHẠC ĐÃ LƯU ---
  const fetchSongs = async () => {
    try {
      console.log('[INFO] Fetching songs from:', `${API_BASE_URL}/music/list`);
      const res = await fetch(`${API_BASE_URL}/music/list`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      console.log('[✓] Fetched', data.length, 'songs');
      // Normalize storage_url to absolute URL so audio src resolves correctly
      const normalized = data.map((s) => {
        const storage = s.storage_url || s.storageUrl || s.url || '';
        const abs = storage.startsWith('http') ? storage : `${SERVER_BASE_URL}${storage}`;
        return { ...s, storage_url: abs };
      });
      setSavedSongs(normalized);
    } catch (e) {
      console.error("[❌] Lỗi khi fetch danh sách nhạc:", e);
    }
  };

  // NEW: HÀM KHỞI TẠO WEB AUDIO API VÀ BẮT ĐẦU PHÂN TÍCH
  const startAudioAnalysis = (audioElement) => {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    
    // 1. Khởi tạo/Kết nối AudioContext
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      
      // Nguồn âm thanh từ thẻ <audio> phải bật crossOrigin="anonymous"
      source = audioContext.createMediaElementSource(audioElement); 
      
      source.connect(analyser);
      analyser.connect(audioContext.destination);

      // Cấu hình AnalyserNode
      analyser.fftSize = 2048; 
      bufferLength = analyser.frequencyBinCount; // 1024 bins
      dataArray = new Uint8Array(bufferLength);
    }
    
    // 2. Hàm phân tích và gửi dữ liệu lặp lại (Animation Loop)
    const analyzeAndSync = () => {
      animationFrameId = requestAnimationFrame(analyzeAndSync);
      
      analyser.getByteFrequencyData(dataArray);

      let bassSum = 0, midSum = 0, trebleSum = 0;
      let bassCount = 0, midCount = 0, trebleCount = 0;
      
      const binWidth = audioContext.sampleRate / 2 / bufferLength;

      for (let i = 0; i < bufferLength; i++) {
        const freq = i * binWidth;
        const value = dataArray[i]; // Cường độ (0-255)

        // Phân loại tần số
        if (freq < BASS_CUTOFF) {
          bassSum += value;
          bassCount++;
        } else if (freq < MID_CUTOFF) {
          midSum += value;
          midCount++;
        } else {
          trebleSum += value;
          trebleCount++;
        }
      }
      
      // Tính trung bình
      const avgBass = bassCount > 0 ? bassSum / bassCount : 0;
      const avgMid = midCount > 0 ? midSum / midCount : 0;
      const avgTreble = trebleCount > 0 ? trebleSum / trebleCount : 0;
      
      // Scale giá trị (0-255) và giới hạn bởi Brightness (255)
      // Hàm đơn giản hóa việc chuyển đổi:
      const scaleValue = (val) => Math.min(brightness, Math.floor(val * 255 / 150)); // Giả sử 150 là cường độ trung bình tối đa

      // Gửi dữ liệu qua Socket.IO
      socket.emit('music_sync', { 
        bass: scaleValue(avgBass), 
        mid: scaleValue(avgMid), 
        treble: scaleValue(avgTreble) 
      });
    };

    analyzeAndSync();
  };
  
  // NEW: Xử lý sự kiện Play/Pause và Đồng bộ
  const handleTogglePlay = (song) => {
    const audioElement = audioRef.current;
    if (!audioElement) return;
    
    // Nếu chưa có bài hát, chọn bài đầu tiên (nếu có)
    const songToPlay = song || currentSong || savedSongs[0];
    if (!songToPlay) return;

    // 1. Nếu chuyển bài (hoặc bắt đầu phát)
    const isNewSong = currentSong?.id !== songToPlay.id || !isPlaying;

    if (isNewSong) {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      setCurrentSong(songToPlay);
      // Đảm bảo source là URL đầy đủ
      const src = songToPlay.storage_url && songToPlay.storage_url.startsWith('http') ? songToPlay.storage_url : `${SERVER_BASE_URL}${songToPlay.storage_url}`;
      
      if(audioElement.src !== src) {
        audioElement.src = src; // Đổi nguồn
      }
      
      // Đặt mode và phát
      setMode("sync"); 
      send("mode", "sync");
      audioElement.playbackRate = playbackRate;
      audioElement.play().then(() => {
        setIsPlaying(true);
        startAudioAnalysis(audioElement);
      });
      return;
    }
    
    // 2. Play/Pause
    if (isPlaying) {
      audioElement.pause();
      setIsPlaying(false);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    } else {
      // Đảm bảo mode là "sync" trước khi phát
      setMode("sync"); 
      send("mode", "sync");
      audioElement.playbackRate = playbackRate;
      audioElement.play().then(() => {
        setIsPlaying(true);
        startAudioAnalysis(audioElement);
      });
    }
  };

  // Play the currently selected song (or the provided song)
  const playSelected = (song) => {
    const audioElement = audioRef.current;
    if (!audioElement) return;

    const toPlay = song || currentSong || savedSongs[0];
    if (!toPlay) return;
    
    // Nếu là bài hát đang phát và chỉ muốn Play/Pause
    if (currentSong?.storage_url === toPlay.storage_url) {
      handleTogglePlay(toPlay);
      return;
    }
    
    // Nếu là bài khác, gọi handleTogglePlay để xử lý đổi bài
    handleTogglePlay(toPlay);
  };

  const pausePlayback = () => {
    const audioElement = audioRef.current;
    if (!audioElement) return;
    audioElement.pause();
    setIsPlaying(false);
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
  };

  const replay = () => {
    const audioElement = audioRef.current;
    if (!audioElement) return;
    audioElement.currentTime = 0;
    playSelected(currentSong);
  };

  const playNext = () => {
    if (!savedSongs || savedSongs.length === 0 || !currentSong) return;
    let idx = savedSongs.findIndex(s => (s._id && currentSong && s._id === currentSong._id) || (s.storage_url === currentSong?.storage_url));
    if (idx === -1) idx = 0;
    const next = savedSongs[(idx + 1) % savedSongs.length];
    playSelected(next);
  };

  const deleteSong = async (song) => {
    if (!song) return;
    if (!confirm(`Xóa bài '${song.title}'? Hành động này không thể hoàn tác.`)) return;
    try {
      // send DELETE with JSON body containing filename for fallback
      const filename = song.storage_url ? song.storage_url.replace(`${SERVER_BASE_URL}/music/`, '') : song.title;
      const res = await fetch(`${API_BASE_URL}/music/${encodeURIComponent(song._id || filename)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      await fetchSongs();
      // if deleted song is current, stop playback
      if (currentSong && ((song._id && currentSong._id === song._id) || currentSong.storage_url === song.storage_url)) {
        pausePlayback();
        setCurrentSong(null);
      }
    } catch (e) {
      console.error('Delete song error:', e);
      alert('Không xóa được bài hát: ' + e.message);
    }
  };
  
  // NEW: Xử lý khi nhạc kết thúc
  const handleSongEnd = () => {
    setIsPlaying(false);
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    // Tùy chọn: Chuyển bài kế tiếp
    playNext();
  };

  // NEW: Xử lý file upload
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Kiểm tra loại file (chỉ cho phép audio)
    if (!file.type.startsWith('audio/')) {
      alert('Vui lòng chọn file audio (.mp3, .wav, v.v.)');
      return;
    }

    // Kiểm tra kích thước (tối đa 50MB)
    if (file.size > 50 * 1024 * 1024) {
      alert('File quá lớn (tối đa 50MB).');
      return;
    }

    // Gửi file lên Server qua API
    const formData = new FormData();
    formData.append('musicFile', file);
    
    try {
      console.log('[INFO] Uploading file to:', `${API_BASE_URL}/music/upload`);
      const res = await fetch(`${API_BASE_URL}/music/upload`, {
        method: 'POST',
        body: formData,
      });

      // Kiểm tra HTTP status
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `HTTP ${res.status}: Upload thất bại`);
      }

      const result = await res.json();
      console.log('Upload response:', result);
      console.log('[✓] Upload thành công!');
      alert('Tải lên thành công!');
      
      // Cập nhật danh sách bài hát từ server
      await fetchSongs();
      
      // Sau khi fetch, tìm bài hát vừa upload trong danh sách
      if (result.song) {
        const uploadedSong = result.song;
        // Normalize storage_url to absolute URL
        const storage = uploadedSong.storage_url || uploadedSong.storageUrl || '';
        uploadedSong.storage_url = storage.startsWith('http') ? storage : `${SERVER_BASE_URL}${storage}`;
        
        // Tự động phát bài vừa upload
        playSelected(uploadedSong);
      }
    } catch (error) {
      console.error('[❌] Upload error:', error);
      alert('Lỗi tải file lên Server: ' + error.message);
    }
    
    // Xóa value input để có thể chọn lại file cùng tên
    event.target.value = '';
  };
  
  // Lấy danh sách nhạc khi component mount
  useEffect(() => {
    (async () => {
      await fetchSongs();
    })();
    return () => {
      // Dọn dẹp
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      if (audioContext && audioContext.state !== 'closed') audioContext.close();
    };
  }, []);
  
  // Hàm xử lý khi tốc độ phát đổi (update audio ref ngay lập tức)
  const handleRateChange = (e) => {
    const newRate = Number(e.target.value);
    setPlaybackRate(newRate);
    if (audioRef.current) audioRef.current.playbackRate = newRate;
  };


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

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 max-w-7xl mx-auto py-10">
          {/* Cột trái */}
          <div className="col-span-1 lg:col-span-7 space-y-10">
            
             {/* NEW: UI cho Music Sync (Chỉ hiển thị khi mode="sync") */}
            {mode === "sync" && (
                <div
                    className="p-8 rounded-3xl shadow-2xl"
                    style={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                    }}
                >
                    <h3 className="text-2xl font-bold mb-6 text-indigo-500">
                        🎵 ĐỒNG BỘ NHẠC
                    </h3>
                    
                    {/* Thẻ Audio Player - Cần thiết cho Web Audio API */}
                    <audio 
                        ref={audioRef}
                        src={currentSong ? currentSong.storage_url : ""} 
                        onEnded={handleSongEnd}
                        crossOrigin="anonymous" // RẤT QUAN TRỌNG
                        className="hidden" // Ẩn thẻ controls mặc định
                    />
                    
                    {/* ======================================= */}
                    {/* NEW: KHU VỰC ĐIỀU KHIỂN PHÁT NHẠC MỚI */}
                    {/* ======================================= */}
                    <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-2xl shadow-inner mb-4">
                        {/* Tên bài hát đang phát */}
                        <div className="flex items-center justify-center p-2 rounded-lg bg-white dark:bg-gray-900 shadow">
                            <span className="text-sm font-medium opacity-70 mr-2">Đang phát:</span>
                            <span className="text-base font-bold truncate text-indigo-500 dark:text-indigo-400">
                                {currentSong ? currentSong.title : "Chưa chọn bài hát"}
                            </span>
                        </div>

                        {/* Main Controls (Play/Pause, Next, Replay) */}
                        <div className="flex justify-center items-center space-x-6 py-1">
                            
                            {/* Replay */}
                            <button 
                                onClick={replay} 
                                className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition opacity-80 hover:opacity-100"
                                title="Phát lại"
                                disabled={!currentSong}
                            >
                                <Repeat2 size={20} className="text-gray-500 dark:text-gray-300" />
                            </button>
                            
                            {/* Play / Pause */}
                            <button 
                                onClick={() => isPlaying ? pausePlayback() : playSelected()} 
                                className={`p-4 rounded-full shadow-xl transform hover:scale-105 transition duration-150 ease-in-out ${
                                    isPlaying ? 'bg-red-500 hover:bg-red-600' : 'bg-indigo-500 hover:bg-indigo-600'
                                } text-white`}
                                disabled={!currentSong}
                            >
                                {isPlaying ? <Pause size={24} fill="white" /> : <Play size={24} fill="white" />}
                            </button>
                            
                            {/* Next */}
                            <button 
                                onClick={playNext} 
                                className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition opacity-80 hover:opacity-100"
                                title="Bài tiếp theo"
                                disabled={savedSongs.length < 2 || !currentSong}
                            >
                                <SkipForward size={20} className="text-gray-500 dark:text-gray-300" />
                            </button>
                        </div>

                        {/* Playback Speed Control (Tốc độ phát) */}
                        <div className="pt-1">
                            <div className="flex justify-between items-center mb-1">
                                <label className="text-sm font-medium opacity-80">Tốc độ phát:</label>
                                <span className="text-lg font-bold text-indigo-500 dark:text-indigo-400">{playbackRate.toFixed(1)}x</span>
                            </div>
                            <input 
                                type="range" 
                                min="0.5" 
                                max="2" 
                                step="0.1" 
                                value={playbackRate} 
                                onChange={handleRateChange} 
                                className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer dark:bg-gray-700" 
                                style={{'--range-track-color': '#4f46e5', '--range-fill-color': '#818cf8'}} 
                            />
                            <div className="flex justify-between text-xs mt-1 opacity-60">
                                <span>0.5x</span>
                                <span>1.0x (Chuẩn)</span>
                                <span>2.0x</span>
                            </div>
                        </div>
                    </div>                    
                    <h4 className="text-xl font-semibold mb-3 mt-4">1. Tải lên file mới</h4>
                    <input 
                        type="file" 
                        accept="audio/*" 
                        onChange={handleFileUpload} 
                        className="file-input file-input-bordered w-full mb-6"
                    />

                    <h4 className="text-xl font-semibold mb-3">2. Danh sách nhạc đã lưu ({savedSongs.length} bài)</h4>
                    <div className="space-y-2 max-h-80 overflow-y-auto p-2 rounded-lg bg-gray-50 dark:bg-gray-800">

                      {savedSongs.map(song => (
                        <div 
                            key={song._id || song.title} 
                            className={`p-3 rounded-xl transition flex justify-between items-center ${currentSong?.storage_url === song.storage_url ? 'bg-indigo-600 text-white shadow-lg' : 'hover:bg-gray-200 dark:hover:bg-gray-700 bg-white dark:bg-gray-900'}`}
                        >
                            <div className="flex-1 truncate cursor-pointer" onClick={() => playSelected(song)}>
                                <div className="font-medium truncate">{song.title}</div>
                                <div className="text-xs opacity-60 truncate">{song.storage_url.split('/').pop()}</div>
                            </div>
                            <div className="flex items-center gap-2 ml-4">
                                {/* Nút Play/Pause nhỏ */}
                                <button 
                                    onClick={(e) => { e.stopPropagation(); playSelected(song); }} 
                                    className={`p-2 rounded-full transition-colors ${currentSong?.storage_url === song.storage_url && isPlaying ? 'text-red-500 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900' : 'text-green-500 hover:bg-green-100 dark:text-green-300 dark:hover:bg-green-900'}`}
                                >
                                    {currentSong?.storage_url === song.storage_url && isPlaying ? <Pause size={18} /> : <Play size={18} />}
                                </button>
                                
                                {/* Nút Xóa */}
                                <button 
                                    onClick={(e) => { e.stopPropagation(); deleteSong(song); }} 
                                    className={`p-2 rounded-full transition-colors ${currentSong?.storage_url === song.storage_url ? 'text-white/80 hover:bg-white/20' : 'text-red-500 hover:bg-red-100 dark:hover:bg-red-900'}`}
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                      ))}

                      {savedSongs.length === 0 && <div className="text-center opacity-60 p-4">Không có bài hát nào được lưu.</div>}
                    </div>
                    
                    <button 
                        onClick={() => handleTogglePlay(currentSong || savedSongs[0])}
                        disabled={savedSongs.length === 0}
                        className={`mt-6 p-4 rounded-xl text-lg font-medium w-full transition ${isPlaying ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'} text-white`}
                    >
                        {isPlaying ? "⏸️ TẠM DỪNG ĐỒNG BỘ" : "▶️ BẮT ĐẦU ĐỒNG BỘ NHẠC"}
                    </button>

                </div>
            )}

            {/* NEW: UI Tùy Chỉnh Màu Sắc (Color Customization) */}
              <div
                className="p-8 rounded-3xl shadow-2xl"
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                }}
              >
                <h3 className="text-2xl font-bold mb-6 text-indigo-500">
                  🎨 TÙY CHỈNH MÀU SẮC
                </h3>
                <div className="flex items-center mb-4">
                  <label className="text-lg font-semibold mr-4" style={{ minWidth: "100px" }}>
                    Độ sáng:
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="255"
                    value={brightness}
                    onChange={handleBrightnessChange}
                    className="range range-primary w-full"
                  />
                </div>
                <div className="flex items-center mb-6">
                  <label className="text-lg font-semibold mr-4" style={{ minWidth: "100px" }}>
                    Màu sắc:
                  </label>
                  <HexColorPicker
                    color={color}
                    onChange={handleColorChange}
                    className="w-full"
                  />
                </div>
                <button
                  onClick={() => {
                      const wasOn = _power;
                      if (wasOn) {
                        // If we're in Music Sync mode, stop analysis and pause audio so LEDs actually turn off
                        if (mode === "sync") {
                          try {
                            const audioElement = audioRef.current;
                            if (audioElement && !audioElement.paused) {
                              audioElement.pause();
                              setIsPlaying(false);
                            }
                          } catch (e) {
                            console.warn('Error pausing audio element:', e);
                          }

                          if (animationFrameId) {
                            cancelAnimationFrame(animationFrameId);
                          }

                          if (audioContext && typeof audioContext.suspend === 'function') {
                            // best-effort suspend the AudioContext
                            audioContext.suspend().catch(() => {});
                          }
                        }

                        send("power", "off");
                        _setPower(false);
                      } else {
                        // Turn ON
                        send("power", "on");
                        _setPower(true);

                        // If we are in Music Sync mode, make a best-effort to resume audio analysis
                        if (mode === "sync") {
                          try {
                            // Resume AudioContext if suspended
                            if (audioContext && typeof audioContext.resume === 'function' && audioContext.state === 'suspended') {
                              audioContext.resume().catch(() => {});
                            }

                            const audioElement = audioRef.current;
                            if (audioElement) {
                              // If we have a current song and it's paused, play and start analysis
                              if (currentSong) {
                                audioElement.play().then(() => {
                                  setIsPlaying(true);
                                  startAudioAnalysis(audioElement);
                                }).catch(() => {
                                  // ignore play errors (autoplay policy), but still try to start analysis if possible
                                  startAudioAnalysis(audioElement);
                                });
                              } else {
                                // No song selected: if audioContext exists, try to (re)start analysis using existing element
                                startAudioAnalysis(audioElement);
                              }
                            }
                          } catch (e) {
                            console.warn('Error while resuming sync on power ON:', e);
                          }
                        }
                      }
                    }}
                  className={`w-full p-4 rounded-xl text-lg font-medium transition-all text-white ${_power ? "bg-red-500 hover:bg-red-600" : "bg-green-500 hover:bg-green-600"}`}
                >
                  {_power ? "⏻ TẮT ĐÈN" : "⏻ BẬT ĐÈN"}
                </button>
              </div>
          </div>
          {/* Cột phải */}
          <div className="space-y-4 col-span-1 lg:col-span-5">
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
              {/* <button
                onClick={() => {
                  // Manual / WiFi control should set mode to 'wifi' so power/color commands work
                  setMode("wifi");
                  send("mode", "wifi");
                }}
                className={`py-8 rounded-3xl text-2xl font-bold transition-all transform hover:scale-105 shadow-xl
      ${mode === "wifi" ? "btn-active" : "btn-inactive"}`}
              >
                Manual Control
              </button> */}
              <button
                onClick={() => {
                  // Manual / WiFi control should set mode to 'wifi' so power/color commands work
                  setMode("sync");
                  send("mode", "sync");
                }}
                className={`py-8 rounded-3xl text-2xl font-bold transition-all transform hover:scale-105 shadow-xl
      ${mode === "sync" ? "btn-active" : "btn-inactive"}`}
              >
                Wifi Sync
              </button>
            </div>
            {/* Mode indicator + Chế độ */}

            {/* Hiệu ứng */}
            <div className="space-y-4 mb-6">
              {EFFECTS_BY_MODE[mode].map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    setEffect(e);
                    if (mode === 'mic') {
                      setMicEffect(e);
                    } else if (mode === 'sync') {
                      setSyncEffect(e);
                    }
                    // send effect command (works in any mode)
                    send('effect', e);
                  }}
                  className={`block w-full text-left px-8 py-6 rounded-2xl text-xl font-medium capitalize transition-all transform hover:scale-105 ${effect === e ? 'btn-active' : 'btn-inactive'}`}
                >
                  {EFFECT_LABELS[e]}
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