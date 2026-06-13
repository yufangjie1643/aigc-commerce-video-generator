# jdcloud deployment helper

This archive intentionally does not include the SSH login private key.

After uploading and extracting on the server:

```bash
cd open-design
bash jdcloud/install-and-run.sh
```

Useful commands:

```bash
bash jdcloud/status.sh
bash jdcloud/stop.sh
bash jdcloud/start.sh
```

Tunnel test from your local machine:

```powershell
powershell -ExecutionPolicy Bypass -File .\jdcloud\tunnel-test-local.ps1 -IdentityFile "$env:USERPROFILE\.ssh\id_rsa-jd.pem"
```

Or run SSH manually:

```bash
ssh -i <your-ssh-key> -L 17573:127.0.0.1:17573 -L 17456:127.0.0.1:17456 root@117.72.120.209
```

Then open http://127.0.0.1:17573.
