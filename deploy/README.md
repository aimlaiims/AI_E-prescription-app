# Running the app on an Ubuntu server

For one Ubuntu 24.04 PC in the hospital, reached by tablets over an ngrok tunnel.
Speech runs on the PC's NVIDIA GPU, so patient audio stays on the machine; the
form-filling step still uses Gemini.

```
tablet --https--> ngrok --> Caddy :8080 (web pages, /api) --> backend :8000 --> PostgreSQL
                                                                       \--> GPU (Whisper)
```

Nothing listens on the network except SSH: ngrok connects outwards, and Caddy and
the backend accept connections from this machine only. Never point the tunnel at 8000.

| Part | What it is | Started by |
|---|---|---|
| `cvf-backend` | the FastAPI backend, as user `cvf` | systemd, at boot |
| `caddy` | serves `frontend/dist`, passes `/api` on | systemd, at boot |
| `postgresql` | the database `cvf` | systemd, at boot |
| `ngrok` | the https address tablets open | systemd, at boot |
| `cvf-backup.timer` | database backup every night at 02:30, kept 30 days | systemd |

## 1. Prepare Ubuntu

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git openssh-server     # openssh-server: to manage it from your PC
sudo ubuntu-drivers install                # NVIDIA driver
sudo reboot
nvidia-smi                                 # after the reboot: shows the card
```

## 2. Get the code (read-only deploy key)

GitHub only lets the server read this one repository, and nothing can be pushed from it.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/cvf_deploy -N "" -C "prescription server"
cat ~/.ssh/cvf_deploy.pub
```

In GitHub: the repository, then **Settings, Deploy keys, Add deploy key**. Paste the line,
leave "Allow write access" off. Then:

```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/cvf_deploy\n' >> ~/.ssh/config
sudo mkdir /opt/cvf && sudo chown "$USER": /opt/cvf
git clone git@github.com:YOUR-ACCOUNT/YOUR-REPO.git /opt/cvf
```

Use `/opt/cvf`, not your home folder: the app's own user cannot read home folders.

## 3. Copy your settings

Copy `backend\.env` from the Windows PC to `/opt/cvf/backend/.env` (USB stick, or
`scp backend\.env YOUR-USER@SERVER-IP:/opt/cvf/backend/.env` from PowerShell). It holds the
API keys and email settings. Then, in that file:

- `APP_BASE_URL=` your ngrok address (step 7), e.g. `https://your-name.ngrok-free.app`
- delete the old `SIGNUP_CODE=` line if it is there (no longer used)

`DATABASE_URL` is set for you in the next step.

## 4. Run the setup

```bash
cd /opt/cvf
sudo bash deploy/setup.sh
```

It installs everything (Python, PostgreSQL, Caddy, Node.js), creates the database and
the `cvf` user, builds the web pages, starts the services, turns the firewall on and
ends with "The app answers on this machine". It can be run again at any time. From
now on `.env` can only be read by the app: edit it with `sudo nano /opt/cvf/backend/.env`.

## 5. Bring your data across (or start empty)

Do this before anyone signs in on the server. On the Windows PC:

```powershell
cd backend; venv\Scripts\activate
python -m tools.backup_database        # makes backend\backups\clinical_forms-<date>.db
```

Copy that `.db` file to the server (e.g. to `/tmp`), then:

```bash
sudo install -o cvf -g cvf -m 600 /tmp/clinical_forms-*.db /var/lib/cvf/import.db
sudo systemctl stop cvf-backend
cd /opt/cvf/backend
sudo -u cvf venv/bin/python -m tools.copy_database \
  --from sqlite:////var/lib/cvf/import.db \
  --to "$(sudo grep '^DATABASE_URL=' .env | cut -d= -f2-)"
sudo systemctl start cvf-backend
sudo rm /var/lib/cvf/import.db
```

It ends with "Every record copied and counted". All accounts, patients and
prescriptions come across. To start empty instead, create the administrator:

```bash
cd /opt/cvf/backend
sudo -u cvf venv/bin/python -m tools.create_admin --email you@example.org --name "Full Name"
```

## 6. Speech on the GPU

Add (or change) these lines in `.env` (`sudo nano /opt/cvf/backend/.env`):

```
WHISPER_BACKEND=local
LOCAL_WHISPER_MODEL=large-v3
LOCAL_WHISPER_DEVICE=cuda
```

Then `sudo systemctl restart cvf-backend`. The first start downloads the model
(about 3 GB, a minute or two); after that it loads in seconds. To check:

```bash
sudo journalctl -u cvf-backend | grep "Local Whisper"
# Local Whisper large-v3 loaded on cuda (auto) in 4.4s
```

large-v3 is the same model Groq runs, so accuracy is the same. To go back to Groq,
set `WHISPER_BACKEND=groq` and restart.

## 7. The tunnel (ngrok)

1. At [dashboard.ngrok.com](https://dashboard.ngrok.com): copy **Your Authtoken**, and
   under **Domains** claim your free static domain (e.g. `your-name.ngrok-free.app`).
2. Install ngrok as on its Linux download page:
   ```bash
   curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
   echo "deb https://ngrok-agent.s3.amazonaws.com bookworm main" | sudo tee /etc/apt/sources.list.d/ngrok.list
   sudo apt update && sudo apt install -y ngrok
   ```
3. Its settings, with your token and domain filled in:
   ```bash
   sudo install -d -m 700 /etc/ngrok
   sudo install -m 600 /opt/cvf/deploy/ngrok.yml.example /etc/ngrok/ngrok.yml
   sudo nano /etc/ngrok/ngrok.yml
   sudo ngrok config check --config /etc/ngrok/ngrok.yml
   ```
4. Run it as a service, so it starts at boot:
   ```bash
   sudo ngrok service install --config /etc/ngrok/ngrok.yml
   sudo ngrok service start
   ```
5. Set `APP_BASE_URL` in `.env` to that address and `sudo systemctl restart cvf-backend`.

Open the address on a tablet. On the free plan ngrok first shows a "You are about
to visit" page: tap **Visit Site** once.

## 8. Check it works

- [ ] Sign in on a tablet through the ngrok address; the microphone works (it needs https)
- [ ] Dictate the whole visit; the review panel fills; Accept; Save; Print
- [ ] Forgot password: the email arrives with the ngrok address in the link
- [ ] `sudo reboot`; a few minutes later the app answers again without you doing anything

## Day to day

| Task | Command |
|---|---|
| Update to the latest version on GitHub | `cd /opt/cvf && bash deploy/update.sh` (backs up first) |
| Is it running? | `systemctl status cvf-backend caddy ngrok` |
| Backend log, live | `sudo journalctl -u cvf-backend -f` |
| Restart the app | `sudo systemctl restart cvf-backend` |
| Backups | `sudo ls -lt /var/backups/cvf` |
| Back up now | `sudo systemctl start cvf-backup` |

**Copy the backups off this machine** (one PC is one disk): for example, plug in a USB
drive once a week and run `sudo rsync -a /var/backups/cvf/ /media/$USER/YOUR-USB/cvf-backups/`.
A backup is proven only once restored: try `pg_restore` into a spare database now and then
(README "Database and backups").

After an update that changes files in `deploy/`, run `sudo bash deploy/setup.sh` again.

## If something is wrong

| You see | Look at / do |
|---|---|
| Tablet: ngrok "endpoint offline" | `systemctl status ngrok`; `sudo ngrok service restart` |
| Tablet: "502 Bad Gateway" | the backend is down: `sudo journalctl -u cvf-backend -n 50` |
| Log: `password authentication failed for user "cvf"` | `DATABASE_URL` in `.env` was changed; restore the line setup wrote |
| Log: `Could not load local Whisper model` | `nvidia-smi` works? If not, the driver (step 1); then `sudo bash deploy/setup.sh` |
| Dictation says the voice service isn't responding | first start after setting up the GPU: wait for "Local Whisper ... loaded" |
| Microphone doesn't work | the address must be the https ngrok one, not the server's IP |
