import os
import tarfile
import paramiko
import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

VPS_IP = "202.134.242.16"
VPS_PORT = 22
VPS_USER = "root"
VPS_PASS = "Akuntorik123890@"
REMOTE_DIR = "/opt/binance-structure-chart"
ARCHIVE_NAME = "binance_frontend_update.tar.gz"

def create_archive():
    print(f"[1/4] Membuat paket update fullstack {ARCHIVE_NAME}...")
    exclude_dirs = {"node_modules", "dist", ".git", ".gemini", "__pycache__", "data", "venv"}
    
    with tarfile.open(ARCHIVE_NAME, "w:gz") as tar:
        for folder in ("frontend", "backend/app"):
            for root, dirs, files in os.walk(folder):
                dirs[:] = [d for d in dirs if d not in exclude_dirs]
                for file in files:
                    if file.endswith(".pyc"):
                        continue
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, ".").replace("\\", "/")
                    tar.add(file_path, arcname=arcname)
                
    size_mb = os.path.getsize(ARCHIVE_NAME) / (1024 * 1024)
    print(f"Paket fullstack berhasil dibuat: {size_mb:.2f} MB")

def deploy():
    create_archive()

    print(f"\n[2/4] Menghubungkan SSH ke VPS Indo {VPS_USER}@{VPS_IP}:{VPS_PORT}...")
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

    remote_archive = f"/tmp/{ARCHIVE_NAME}"
    print(f"\n[3/4] Mengunggah {ARCHIVE_NAME} ke VPS...")
    sftp = client.open_sftp()
    sftp.put(ARCHIVE_NAME, remote_archive)
    sftp.close()
    print("Unggah selesai!")

    print(f"\n[4/4] Ekstrak & rebuild backend + frontend container...")
    exec_cmd(f"tar -xzf {remote_archive} -C {REMOTE_DIR}")
    exec_cmd("docker compose build backend frontend", cwd=REMOTE_DIR)
    exec_cmd("docker compose up -d backend frontend", cwd=REMOTE_DIR)

    print("\n--- Status Kontainer ---")
    exec_cmd("docker compose ps", cwd=REMOTE_DIR)

    print("\n--- Verifikasi Frontend HTTP Response ---")
    exec_cmd("curl -sI http://localhost:3050 | head -n 5")

    client.close()

    if os.path.exists(ARCHIVE_NAME):
        os.remove(ARCHIVE_NAME)

    print("\n=======================================================")
    print("  UPDATE FRONTEND VPS INDO BERHASIL!")
    print(f"  Web App UI : http://{VPS_IP}:3050")
    print("=======================================================")

if __name__ == "__main__":
    deploy()
