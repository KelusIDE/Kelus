"""Jupyter kernel bridge: JSON-line commands on stdin, JSON-line events on stdout.

Runs under the interpreter the user picked, so the kernel sees that interpreter's packages.
All ZeroMQ traffic stays on the main thread; stdin is read on a helper thread.
"""
import argparse
import json
import os
import queue
import sys
import threading


def emit(event):
    sys.stdout.write(json.dumps(event, default=str) + "\n")
    sys.stdout.flush()


def to_output(msg_type, content):
    if msg_type == "stream":
        return {"output_type": "stream", "name": content.get("name", "stdout"), "text": content.get("text", "")}
    if msg_type in ("execute_result", "display_data", "update_display_data"):
        output = {
            "output_type": "execute_result" if msg_type == "execute_result" else "display_data",
            "data": content.get("data", {}),
            "metadata": content.get("metadata", {}),
        }
        if msg_type == "execute_result":
            output["execution_count"] = content.get("execution_count")
        return output
    if msg_type == "error":
        return {
            "output_type": "error",
            "ename": content.get("ename", ""),
            "evalue": content.get("evalue", ""),
            "traceback": content.get("traceback", []),
        }
    return None


def read_commands(commands):
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            commands.put(json.loads(line))
        except ValueError:
            emit({"event": "error", "message": "Invalid bridge command: " + line[:200]})
    commands.put({"op": "shutdown"})


def start(cwd):
    from jupyter_client import KernelManager
    from jupyter_client.kernelspec import KernelSpec

    manager = KernelManager()
    # Pin the kernel to this interpreter; a user-installed "python3" kernelspec could point elsewhere.
    manager._kernel_spec = KernelSpec(
        argv=[sys.executable, "-m", "ipykernel_launcher", "-f", "{connection_file}"],
        display_name="Python 3", language="python",
    )
    env = dict(os.environ)
    env.setdefault("MPLBACKEND", "module://matplotlib_inline.backend_inline")
    env.pop("PYTHONUNBUFFERED", None)
    manager.start_kernel(cwd=cwd, env=env)
    client = manager.client()
    client.start_channels()
    client.wait_for_ready(timeout=120)
    return manager, client


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cwd", required=True)
    args = parser.parse_args()

    missing = [name for name in ("jupyter_client", "ipykernel") if not _importable(name)]
    if missing:
        emit({"event": "missing", "packages": missing, "python": sys.executable})
        return 2

    emit({"event": "status", "state": "starting"})
    try:
        manager, client = start(args.cwd)
    except Exception as error:  # noqa: BLE001 - report any startup failure to the UI
        emit({"event": "error", "message": "Kernel failed to start: %s" % error})
        emit({"event": "status", "state": "dead"})
        return 1
    emit({"event": "ready", "python": sys.executable, "version": sys.version.split()[0]})
    emit({"event": "status", "state": "idle"})

    commands = queue.Queue()
    threading.Thread(target=read_commands, args=(commands,), daemon=True).start()
    cells = {}  # msg_id -> cell id
    alive = True

    def finish_all(status):
        for cell in list(cells.values()):
            emit({"event": "done", "cell": cell, "status": status})
        cells.clear()

    while True:
        try:
            while True:
                command = commands.get_nowait()
                op = command.get("op")
                if op == "execute":
                    msg_id = client.execute(command.get("code", ""), allow_stdin=False, stop_on_error=True)
                    cells[msg_id] = command.get("cell")
                elif op == "interrupt":
                    manager.interrupt_kernel()
                elif op == "restart":
                    emit({"event": "status", "state": "restarting"})
                    finish_all("aborted")
                    manager.restart_kernel(now=True)
                    client.wait_for_ready(timeout=120)
                    alive = True
                    emit({"event": "status", "state": "idle"})
                elif op == "shutdown":
                    finish_all("aborted")
                    client.stop_channels()
                    manager.shutdown_kernel(now=True)
                    emit({"event": "status", "state": "dead"})
                    return 0
        except queue.Empty:
            pass

        if alive and not manager.is_alive():
            alive = False
            finish_all("aborted")
            emit({"event": "status", "state": "dead"})
            emit({"event": "error", "message": "Kernel died. Restart it to continue."})

        try:
            msg = client.get_iopub_msg(timeout=0.05)
        except queue.Empty:
            msg = None
        if msg:
            handle_iopub(msg, cells)

        try:
            reply = client.get_shell_msg(timeout=0)
        except queue.Empty:
            reply = None
        if reply and reply["content"].get("status") == "aborted":
            cell = cells.pop(reply["parent_header"].get("msg_id"), None)
            if cell is not None:
                emit({"event": "done", "cell": cell, "status": "aborted"})


def handle_iopub(msg, cells):
    msg_type = msg["header"]["msg_type"]
    content = msg["content"]
    parent = msg.get("parent_header", {}).get("msg_id")
    cell = cells.get(parent)
    if msg_type == "status":
        emit({"event": "status", "state": content.get("execution_state")})
        if content.get("execution_state") == "idle" and cell is not None:
            cells.pop(parent, None)
            emit({"event": "done", "cell": cell, "status": "ok"})
        return
    if msg_type == "execute_input":
        if cell is not None:
            emit({"event": "count", "cell": cell, "count": content.get("execution_count")})
        return
    if msg_type == "clear_output":
        if cell is not None:
            emit({"event": "clear", "cell": cell, "wait": bool(content.get("wait"))})
        return
    output = to_output(msg_type, content)
    if output is None:
        return
    display_id = (content.get("transient") or {}).get("display_id")
    if msg_type == "update_display_data":
        if display_id:
            emit({"event": "update", "display_id": display_id, "output": output})
        return
    if cell is not None:
        emit({"event": "output", "cell": cell, "output": output, "display_id": display_id})


def _importable(name):
    try:
        __import__(name)
        return True
    except ImportError:
        return False


if __name__ == "__main__":
    sys.exit(main())
