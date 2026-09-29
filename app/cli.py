"""Admin CLI. Usage: python -m app.cli reset-password <username>"""

import argparse
import asyncio
import getpass
import sys

from app.auth.auth_routes import PASSWORD_MAX, PASSWORD_MIN
from app.auth.password_hashing import hash_password
from app.config import get_settings
from app.db import Database
from app.repositories.session_repository import SessionRepository
from app.repositories.user_repository import UserRepository


async def reset_password(username: str, new_password: str) -> int:
    """Set a new password and revoke every session of the user. Returns revoked session count."""
    db = Database(get_settings().db_path)
    await db.connect()
    try:
        users = UserRepository(db)
        user = await users.get_by_username(username)
        if user is None:
            raise LookupError(username)
        await users.update_password_hash(user.id, hash_password(new_password))
        return await SessionRepository(db).delete_for_user(user.id)
    finally:
        await db.close()


def _prompt_password() -> str:
    first = getpass.getpass("Mật khẩu mới: ")
    if not PASSWORD_MIN <= len(first) <= PASSWORD_MAX:
        sys.exit(f"Mật khẩu phải {PASSWORD_MIN}–{PASSWORD_MAX} ký tự")
    if getpass.getpass("Nhập lại: ") != first:
        sys.exit("Hai lần nhập không khớp")
    return first


def main(argv: list[str] | None = None) -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")  # Vietnamese help text on Windows consoles
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    reset = sub.add_parser("reset-password", help="Đặt lại mật khẩu và đăng xuất mọi thiết bị")
    reset.add_argument("username")
    args = parser.parse_args(argv)

    if args.command == "reset-password":
        password = _prompt_password()
        try:
            revoked = asyncio.run(reset_password(args.username, password))
        except LookupError:
            sys.exit(f"Không có tài khoản '{args.username}'")
        print(f"Đã đổi mật khẩu cho {args.username}; đăng xuất {revoked} phiên.")


if __name__ == "__main__":
    main()
