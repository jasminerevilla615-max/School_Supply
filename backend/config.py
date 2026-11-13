import os
import secrets
from pathlib import Path
from time import sleep

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_PORT = int(os.environ.get("DB_PORT", "3306"))
DB_NAME = os.environ.get("DB_NAME", "my_school_supply_db")
DB_USER = os.environ.get("DB_USER", "root")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "")


def _load_secret_key():
    configured_secret = os.environ.get("SCHOOL_SUPPLY_SECRET")
    if configured_secret:
        return configured_secret

    secret_file = ROOT_DIR / ".flask_secret"
    try:
        with secret_file.open("x", encoding="ascii") as file:
            file.write(secrets.token_hex(32))
            file.flush()
            os.fsync(file.fileno())
    except FileExistsError:
        pass

    for _ in range(20):
        try:
            secret = secret_file.read_text(encoding="ascii").strip()
        except FileNotFoundError:
            secret = ""
        if secret:
            return secret
        sleep(0.01)
    raise RuntimeError(f"Unable to read the Flask session secret from {secret_file}.")


SECRET_KEY = _load_secret_key()
CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
