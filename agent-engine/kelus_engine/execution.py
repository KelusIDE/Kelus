"""Single permission boundary for agent workspace operations and commands."""
import os
import shlex
import subprocess
from pathlib import Path


class ExecutionService:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def path(self, relative: str) -> Path:
        path = Path(relative)
        if not relative or path.is_absolute() or '..' in path.parts:
            raise ValueError('Invalid workspace path')
        target = (self.root / path).resolve()
        if not target.is_relative_to(self.root) or target == self.root:
            raise ValueError('Path escapes project folder')
        return target

    def read(self, relative: str) -> str:
        return self.path(relative).read_text(encoding='utf-8')

    def write_approved(self, relative: str, content: str, approved: bool) -> None:
        if not approved:
            raise PermissionError('File write requires approval')
        target = self.path(relative)
        if not target.parent.is_dir():
            raise FileNotFoundError('Parent directory does not exist')
        target.write_text(content, encoding='utf-8')

    def restore_after_failed_run(self, relative: str, original: str | None) -> None:
        """Undo a previously approved candidate after verification fails."""
        target = self.path(relative)
        if original is None:
            target.unlink(missing_ok=True)
        else:
            target.write_text(original, encoding='utf-8')

    def run_approved(self, command: str, approved: bool) -> tuple[int, str]:
        if not approved:
            raise PermissionError('Command execution requires approval')
        args = shlex.split(command, posix=os.name != 'nt')
        if not args:
            raise ValueError('Empty test command')
        # No shell expansion or pipelines. The user approves the exact executable and arguments.
        try:
            result = subprocess.run(args, cwd=self.root, capture_output=True, text=True, timeout=120, check=False)
            return result.returncode, (result.stdout + result.stderr)[-16000:]
        except subprocess.TimeoutExpired as error:
            return 124, f'Test command timed out after 120 seconds: {error}'
