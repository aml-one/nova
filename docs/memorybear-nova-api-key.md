# MemoryBear API key for Nova (where it comes from)

Nova does **not** invent this key. It is created by **your MemoryBear** server and pasted into **Nova → Settings → Memory & cores** (or set as `NOVA_MEMORYBEAR_API_KEY` on the agent-core process).

## If you used Nova’s Mac bootstrap script

Script: `scripts/memorybear-mac-bootstrap.sh` in this repo.

1. It logs into MemoryBear as **`admin@example.com`** with password **`NovaPassword7880`** unless you set `MB_PASSWORD` (see script header).
2. It calls **`POST http://127.0.0.1:8000/api/apikeys`** with scopes **`memory`** and writes the raw key to:

   **`$HOME/nova-deps/memorybear-nova-api-key.txt`**

   (override with `KEYFILE=/path/to/file` when running the script.)

3. Re-run the script on the **machine that runs MemoryBear** if the file is missing:

   ```bash
   cd /path/to/Nova
   MB_PASSWORD='your-secret' bash scripts/memorybear-mac-bootstrap.sh
   ```

## If MemoryBear is already running (find or create a key in the UI)

| What | URL |
|------|-----|
| OpenAPI / Swagger (try keys and auth here) | **http://127.0.0.1:8000/docs** |
| MemoryBear source & install | **https://github.com/SuanmoSuanyangTechnology/MemoryBear** |

Typical flow:

1. Open **http://127.0.0.1:8000/docs** (replace host/port if your API is elsewhere).
2. Obtain a JWT (e.g. **`POST /api/token`** with your admin email/password), or use the MemoryBear **web** login if your install exposes it.
3. Create a **service** API key with **`memory`** scope (bootstrap uses **`POST /api/apikeys`** with body like `{"name":"Nova","type":"service","scopes":["memory"],"description":"Nova agent integration"}`).
4. Copy the **`api_key`** value from the response (shown once) into Nova Settings.

## Nova install guide (full stack context)

See **§10 Optional: MemoryBear** in:

**https://github.com/aml-one/nova/blob/main/docs/install-nova-complete-guide.md**

(Local clone: `docs/install-nova-complete-guide.md`.)
