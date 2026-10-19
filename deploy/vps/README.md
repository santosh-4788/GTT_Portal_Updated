# Hosting the portal on a VPS (Hostinger KVM / Bluehost VPS)

The portal runs as one Node process behind Nginx, with free HTTPS from
Let's Encrypt. The database is a SQLite file on the server's own disk, so
there's no separate database server to set up or pay for.

```
Browser ──HTTPS──► Nginx (443, certificate) ──► Node / pm2 (127.0.0.1:4100) ──► database/gtt.db
```

## 1. Buy and prepare the server

- **Hostinger:** VPS → KVM 1 or higher, OS template **Ubuntu 24.04** (plain,
  no panel), location **India (Mumbai)**.
- **Bluehost:** any VPS plan with Ubuntu 22.04/24.04.
- Note the server's **IP address** and **root password** (or add your SSH key).

## 2. Point the domain at it

In the DNS settings of the domain, add:

| Type | Name  | Value          |
|------|-------|----------------|
| A    | `@`   | server IP      |
| A    | `www` | server IP      |

Wait until `ping yourdomain.in` shows the server IP. That can take anywhere
from a few minutes to a few hours.

## 3. Push the code

The server pulls the code from GitHub, so commit and push first:

```
git push updated main
```

If the repository is **private**, create a GitHub token with read access
(Settings → Developer settings → Fine-grained tokens) and use
`https://<token>@github.com/santosh-4788/GTT_Portal_Updated.git` as the repo
URL in the next step.

## 4. Run the setup (once)

From Windows PowerShell:

```
ssh root@<server-ip>
```

Then on the server:

```
curl -fsSL https://raw.githubusercontent.com/santosh-4788/GTT_Portal_Updated/main/deploy/vps/setup.sh -o setup.sh
sudo bash setup.sh yourdomain.in vinaykumar87674@gmail.com
```

(For a private repo, pass the token URL as the 3rd argument. You'll also need
to copy `setup.sh` to the server with `scp`, because `curl` can't download it
without the token.)

It takes 10–15 minutes. When it finishes, open `https://yourdomain.in`.
Then sign in as `Admin@gmail.com` / `Pass@123` and change the password.

Set `WITH_LIBREOFFICE=0` before the command to skip LibreOffice. That saves
about 500 MB, but invoices are then only produced as XLSX/DOCX, without the PDF.

## 5. Bring the existing data across

**From this PC's database:** stop the portal on the PC first so the file is
complete, then from PowerShell in `E:\Portal\GuptaToursAndTravels`:

```
scp database\gtt.db root@<server-ip>:/home/gtt/app/database/gtt.db
scp -r templates data\invoices root@<server-ip>:/home/gtt/app/
ssh root@<server-ip> "mv /home/gtt/app/invoices/* /home/gtt/app/data/invoices/ 2>/dev/null; chown -R gtt:gtt /home/gtt/app; sudo -u gtt -i pm2 restart gtt"
```

**Or keep using Turso** (the data the Vercel site uses): put
`TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in `/home/gtt/app/backend/.env`
and restart. The data stays in Turso and the VPS just runs the app.

## Everyday commands (on the server)

```
sudo -i -u gtt                       # become the app user first
pm2 status                           # is it running?
pm2 logs gtt                         # live logs
pm2 restart gtt --update-env         # after editing backend/.env
bash ~/app/deploy/vps/update.sh      # pull latest code, rebuild, restart (backs up first)
bash ~/app/deploy/vps/backup.sh      # backup now (also runs daily at 02:30)
ls ~/app/data/backups                # backups, kept for 30 days
```

- **Settings:** `/home/gtt/app/backend/.env`. Add the Gmail app password here
  (`MAIL_APP_PASSWORD`) so emails go out.
- **HTTPS renewal:** automatic (`systemctl list-timers | grep certbot`).
- **Off-server copy:** download a backup to the PC now and then:
  `scp -r root@<server-ip>:/home/gtt/app/data/backups E:\Portal\VPS-Backups`

## Files in this folder

| File | Purpose |
|------|---------|
| `setup.sh` | One-time server setup (safe to re-run) |
| `update.sh` | Deploy the latest code |
| `backup.sh` | Database + invoice backup with 30-day cleanup |
| `ecosystem.config.cjs` | pm2 process definition |
| `nginx.conf` | Nginx site template (Certbot adds the HTTPS part) |
