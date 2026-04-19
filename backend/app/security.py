from cryptography.fernet import Fernet

from .config import get_settings

_settings = get_settings()
_fernet = Fernet(_settings.encryption_key.encode())


def encrypt(plaintext: str) -> str:
    return _fernet.encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    return _fernet.decrypt(ciphertext.encode()).decode()
