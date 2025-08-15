import subprocess

# === KULLANICI AYARLARI ===
# Hikvision RTSP bağlantısı (gerekirse kullanıcı adı ve şifre ile)
rtsp_url = "rtsp://admin:12345qwe@192.168.88.7:554/Streaming/Channels/101"

# YouTube yayın anahtarınızı buraya yapıştırın
youtube_stream_key = "0jmk-jsej-cprp-c18s-cb2k"

# YouTube RTMP URL (Sabit)
youtube_rtmp_url = f"rtmp://a.rtmp.youtube.com/live2/{youtube_stream_key}"

# === FFMPEG KOMUTU ===
ffmpeg_cmd = [
    "ffmpeg",
    "-rtsp_transport", "tcp",  # daha güvenli bağlantı
    "-i", rtsp_url,
    "-vcodec", "libx264",
    "-preset", "veryfast",
    
    "-tune", "zerolatency",
    "-maxrate", "3000k",
    "-bufsize", "6000k",
    "-g", "50",
    "-acodec", "aac",
    "-b:a", "128k",
    "-ar", "44100",
    "-f", "flv",
    youtube_rtmp_url
]

# === FFMPEG BAŞLAT ===
try:
    print("🎥 Yayın başlatılıyor... Ctrl+C ile durdurabilirsiniz.")
    subprocess.run(ffmpeg_cmd)
except KeyboardInterrupt:
    print("\n🛑 Yayın durduruldu.")
