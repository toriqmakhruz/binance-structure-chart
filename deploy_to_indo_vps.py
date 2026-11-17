import os
import tarfile
import paramiko
import time
import sys

# Ensure UTF-8 output on Windows console
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

VPS_IP = "202.134.242.16"
VPS_PORT = 22
VPS_USER = "root"
VPS_PASS = "Akuntorik123890@"
REMOTE_DIR = "/opt/binance-structure-chart"
ARCHIVE_NAME = "binance_chart_indo_deploy.tar.gz"

def create_archive():
    print(f"[1/6] Membuat paket deploy {ARCHIVE_NAME}...")
    exclude_dirs = {"venv", "node_modules", "dist", "__pycache__", ".git", ".pytest_cache", "data", "graphify-out", ".gemini", "VIDEO", "extracted_frames"}
    
    with tarfile.open(ARCHIVE_NAME, "w:gz") as tar:
        for root, dirs, files in os.walk("."):
            dirs[:] = [d for d in dirs if d not in exclude_dirs]
            for file in files:
                if file.endswith((".tar.gz", ".log", ".pyc", ".bak", ".mp4")):
                    continue
                if file in ("deploy_to_vps.py", "deploy_update.py", "test_vps.py", "indo_diagnose.py", "deploy_to_indo_vps.py"):
                    continue
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, ".")
                tar.add(file_path, arcname=arcname)
                
    size_mb = os.path.getsize(ARCHIVE_NAME) / (1024 * 1024)
    print(f"Paket berhasil dibuat: {size_mb:.2f} MB")

def deploy():
    create_archive()

    print(f"\n[2/6] Menghubungkan SSH ke VPS Indo {VPS_USER}@{VPS_IP}:{VPS_PORT}...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(VPS_IP, port=VPS_PORT, username=VPS_USER, password=VPS_PASS, timeout=30)
    print("Koneksi SSH berhasil!")

    def exec_cmd(cmd, cwd=None, check=True):
        full_cmd = f"cd {cwd} && {cmd}" if cwd else cmd
        print(f"\n> {full_cmd}")
        stdin, stdout, stderr = client.exec_command(full_cmd, get_pty=True)
        for raw_line in stdout:
            safe_line = raw_line.encode("ascii", errors="replace").decode("ascii")
            print(safe_line, end="")
        exit_status = stdout.channel.recv_exit_status()
        if check and exit_status != 0:
            print(f"Perintah gagal dengan exit code {exit_status}")
        return exit_status

    print("\n[3/6] Konfigurasi Sistem: Swap 2GB & DNS Bypass (Cloudflare/Google)...")
    setup_sys_script = """
set -e
# 1. Setup 2GB Swap jika belum ada (wajib untuk 1GB RAM)
if [ ! -f /swapfile ]; then
    echo "Membuat 2GB Swapfile..."
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "Swapfile aktif!"
else
    echo "Swapfile sudah ada."
fi

# 2. DNS Bypass setup (Cloudflare 1.1.1.1 & Google 8.8.8.8)
echo "Mengonfigurasi DNS Bypass..."
mkdir -p /etc/systemd/resolved.conf.d
cat << 'EOF' > /etc/systemd/resolved.conf.d/dns_servers.conf
[Resolve]
DNS=1.1.1.1 1.0.0.1 8.8.8.8 8.8.4.4
FallbackDNS=9.9.9.9
Domains=~.
EOF
systemctl restart systemd-resolved 2>/dev/null || true

# Pastikan /etc/resolv.conf berisi nameserver bebas sensor
chattr -i /etc/resolv.conf 2>/dev/null || true
cat << 'EOF' > /etc/resolv.conf
nameserver 1.1.1.1
nameserver 1.0.0.1
nameserver 8.8.8.8
nameserver 8.8.4.4
EOF

# 3. Instalasi Docker jika belum ada
if ! command -v docker &> /dev/null; then
    echo "Menginstal Docker CE & Docker Compose..."
    apt-get update -y
    apt-get install -y ca-certificates curl gnupg
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

# 4. Konfigurasi DNS di Docker Daemon jika belum ada
if [ ! -f /etc/docker/daemon.json ]; then
    mkdir -p /etc/docker
    cat << 'EOF' > /etc/docker/daemon.json
{
  "dns": ["1.1.1.1", "1.0.0.1", "8.8.8.8"]
}
EOF
    systemctl restart docker
fi

echo "Sistem siap dan Docker berjalan!"
"""
    exec_cmd(setup_sys_script)

    remote_archive = f"/tmp/{ARCHIVE_NAME}"
    print(f"\n[4/6] Mengunggah {ARCHIVE_NAME} ke VPS...")
    sftp = client.open_sftp()
    sftp.put(ARCHIVE_NAME, remote_archive)
    sftp.close()
    print("Unggah selesai!")

    print(f"\n[5/6] Mengekstrak kode ke {REMOTE_DIR}...")
    exec_cmd(f"mkdir -p {REMOTE_DIR} && tar -xzf {remote_archive} -C {REMOTE_DIR}")

    print("\n[6/6] Membangun dan menjalankan kontainer Docker...")
    exit_code = exec_cmd("docker compose up -d --build", cwd=REMOTE_DIR)

    print("\n--- Status Kontainer ---")
    exec_cmd("docker compose ps", cwd=REMOTE_DIR)

    print("\n--- Verifikasi Endpoint Backend & Frontend ---")
    exec_cmd("sleep 3")
    exec_cmd("curl -s http://localhost:8050/health; echo ''")
    exec_cmd("curl -s http://localhost:8050/api/telegram/settings; echo ''")
    exec_cmd("curl -sI http://localhost:3050 | head -n 5")

    print("\n--- Verifikasi Koneksi Binance dari Container Backend ---")
    exec_cmd("docker exec binance_analysis_backend python -c \"import httpx; r = httpx.get('https://fapi.binance.com/fapi/v1/time', timeout=5); print('Binance FAPI ping via container:', r.json())\"")
    exec_cmd("curl -s 'http://localhost:8050/api/symbols?market=futures' | head -c 200; echo ''")

    client.close()

    if os.path.exists(ARCHIVE_NAME):
        os.remove(ARCHIVE_NAME)

    if exit_code == 0:
        print("\n=======================================================")
        print("  DEPLOY VPS INDO BERHASIL 100%!")
        print(f"  Web App UI : http://{VPS_IP}:3050")
        print(f"  Backend API: http://{VPS_IP}:8050")
        print("=======================================================")
    else:
        print(f"\nDeploy selesai dengan kode: {exit_code}")

if __name__ == "__main__":
    deploy()
