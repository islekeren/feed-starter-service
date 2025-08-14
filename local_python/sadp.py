import socket
import os
import xml.etree.ElementTree as ET
from prettytable import PrettyTable
import time

def send_udp_broadcast(packet, port, broadcast_ip):
    """Send a UDP broadcast packet."""
    # Mac'te broadcast için belirli bir arayüze bind etmeye gerek yok.
    # Boş string '' tüm arayüzleri dinlemesini sağlar.
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.sendto(packet, (broadcast_ip, port))
        print("Ağdaki cihazlar için keşif paketi gönderildi. Yanıtlar bekleniyor...")

def listen_for_responses(port, timeout=5):
    """Listen for UDP packets for a specific duration and return found devices."""
    seen_devices = {}
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("", port))
        except OSError as e:
            print(f"Hata: Port {port} zaten kullanılıyor olabilir. {e}")
            return
            
        sock.settimeout(1.0)  # Her recvfrom için 1 saniye bekle
        
        start_time = time.time()
        while time.time() - start_time < timeout:
            try:
                data, addr = sock.recvfrom(24000)
                # Sadece XML verisi olanları işlemeye çalış
                if data.strip().startswith(b'<?xml'):
                    try:
                        root = ET.fromstring(data.decode('utf-8'))
                        # XML Namespace'i temizleme (Hikvision bazen ekler)
                        for elem in root.iter():
                            if '}' in elem.tag:
                                elem.tag = elem.tag.split('}', 1)[1]

                        # Alanları güvenli bir şekilde bulma
                        mac = root.find('.//MAC')
                        desc = root.find('.//DeviceDescription')
                        sn = root.find('.//DeviceSN')
                        ipv4 = root.find('.//IPv4Address')
                        dhcp = root.find('.//DHCP')

                        if mac is not None and ipv4 is not None:
                            seen_devices[mac.text] = {
                                "IPV4": ipv4.text if ipv4 is not None else 'N/A',
                                "Description": desc.text if desc is not None else 'N/A',
                                "Serial": sn.text if sn is not None else 'N/A',
                                "DHCP": dhcp.text if dhcp is not None else 'N/A'
                            }
                    except ET.ParseError:
                        # Geçersiz XML, görmezden gel
                        continue
            except socket.timeout:
                continue

    return seen_devices

def display_info(devices):
    """Display the device information in a table format."""
    os.system('clear' if os.name == 'posix' else 'cls')
    
    if not devices:
        print("Ağda herhangi bir uyumlu cihaz bulunamadı.")
        print("İpuçları:")
        print("- Mac ve kameranın aynı ağa (switch'e) bağlı olduğundan emin olun.")
        print("- Mac'inizin güvenlik duvarı ayarlarını kontrol edin.")
        print("- Kodu 'sudo python3 kamera_bul.py' olarak çalıştırmayı deneyin.")
        return

    table = PrettyTable()
    table.field_names = ["IPV4 Adresi", "MAC Adresi", "Açıklama", "Seri Numarası", "DHCP Aktif"]
    table.align["IPV4 Adresi"] = "l"
    table.align["MAC Adresi"] = "l"

    for mac, info in devices.items():
        table.add_row([info["IPV4"], mac, info["Description"], info["Serial"], info["DHCP"]])

    print("Bulunan Cihazlar:")
    print(table)


if __name__ == '__main__':
    # WS-Discovery Probe Mesajı
    packet = b'<?xml version="1.0" encoding="utf-8"?><Probe><Uuid>74F1ED37-5E82-43E8-9A61-66FCD32926E2</Uuid><Types>inquiry</Types></Probe>'
    broadcast_ip = "239.255.255.250"
    port = 37020
    
    send_udp_broadcast(packet, port, broadcast_ip)
    found_devices = listen_for_responses(port, timeout=5) # 5 saniye dinle
    display_info(found_devices)