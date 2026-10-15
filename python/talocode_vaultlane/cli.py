import json
import sys

from .engine import keeper_step, plan_vault
from .prices import credit_prices


def _flag(name):
    prefix = f"--{name}="
    for arg in sys.argv[2:]:
        if arg.startswith(prefix):
            return arg[len(prefix):]
    return None


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"
    if cmd == "prices":
        result = credit_prices()
    elif cmd == "plan":
        path = _flag("file")
        if not path:
            sys.stderr.write("Usage: vaultlane plan --file=\n")
            return 2
        result = plan_vault(json.loads(open(path, encoding="utf-8").read()))
    elif cmd == "quote":
        vault_path = _flag("file")
        book_path = _flag("book")
        if not vault_path or not book_path:
            sys.stderr.write("Usage: vaultlane quote --file= --book=\n")
            return 2
        now = _flag("now")
        result = keeper_step(
            json.loads(open(vault_path, encoding="utf-8").read()),
            json.loads(open(book_path, encoding="utf-8").read()),
            float(now) if now else None,
        )
    else:
        sys.stderr.write("Usage: vaultlane plan|quote|prices\n")
        return 2
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0 if result.get("ok") else 1
