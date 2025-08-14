
import subprocess
import datetime
import os

# === KULLANICI AYARLARI ===
rtsp_url = "rtsp://admin:12345qwe@192.168.88.7:554/Streaming/Channels/101"

# Kayıt yapılacak klasör
output_dir = "recordings"
os.makedirs(output_dir, exist_ok=True)

# Zaman damgalı dosya adı
timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
output_file = os.path.join(output_dir, f"camera_record_{timestamp}.mp4")

# === FFMPEG KOMUTU (video + ses) ===
ffmpeg_cmd = [
    "ffmpeg",
    "-rtsp_transport", "tcp",
    "-i", rtsp_url,
    "-c:v", "libx264",         # video codec
    "-preset", "ultrafast",    # hızlı encode
    "-crf", "18",              # kalite
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",             # ses codec (AAC)
    "-b:a", "128k",            # ses bitrate
    "-ar", "44100",            # ses örnekleme hızı
    "-ac", "1",                # tek kanal (mono) – istenirse "2" yapılabilir
    "-t", "00:30:00",          # kayıt süresi
    output_file
]

# === KAYDI BAŞLAT ===
try:
    print(f"🔊 Sesli kayıt başlatılıyor: {output_file}")
    subprocess.run(ffmpeg_cmd)
except KeyboardInterrupt:
    print("\n🛑 Kayıt manuel olarak durduruldu.")
