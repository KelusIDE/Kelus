"""macOS mouse/keyboard driver for Kelus computer control.

JSON-line commands on stdin, one JSON reply per command on stdout. Coordinates are global
display points (origin at the top-left of the main display). Uses CoreGraphics through ctypes,
so it needs no third-party packages; macOS only posts the events when Kelus has the
Accessibility permission. KELUS_COMPUTER_DRY_RUN=1 builds every event but never posts it.
"""
import ctypes
import json
import os
import sys
import time

DRY_RUN = os.environ.get('KELUS_COMPUTER_DRY_RUN') == '1'
CG = ctypes.cdll.LoadLibrary('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices')
CF = ctypes.cdll.LoadLibrary('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')


class CGPoint(ctypes.Structure):
    _fields_ = [('x', ctypes.c_double), ('y', ctypes.c_double)]


CG.CGEventCreateMouseEvent.restype = ctypes.c_void_p
CG.CGEventCreateMouseEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint32, CGPoint, ctypes.c_uint32]
CG.CGEventCreateKeyboardEvent.restype = ctypes.c_void_p
CG.CGEventCreateKeyboardEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint16, ctypes.c_bool]
CG.CGEventCreateScrollWheelEvent2.restype = ctypes.c_void_p
CG.CGEventCreateScrollWheelEvent2.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_int32, ctypes.c_int32, ctypes.c_int32]
CG.CGEventKeyboardSetUnicodeString.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_uint16)]
CG.CGEventSetFlags.argtypes = [ctypes.c_void_p, ctypes.c_uint64]
CG.CGEventSetIntegerValueField.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int64]
CG.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
CF.CFRelease.argtypes = [ctypes.c_void_p]

HID_TAP = 0
CLICK_STATE = 1
MOUSE = {  # button -> (down, up, dragged, CGMouseButton)
    'left': (1, 2, 6, 0),
    'right': (3, 4, 7, 1),
}
MOVED = 5
FLAGS = {'cmd': 0x100000, 'command': 0x100000, 'shift': 0x20000, 'ctrl': 0x40000, 'control': 0x40000,
         'alt': 0x80000, 'option': 0x80000, 'opt': 0x80000, 'fn': 0x800000}
KEYS = {
    'a': 0, 's': 1, 'd': 2, 'f': 3, 'h': 4, 'g': 5, 'z': 6, 'x': 7, 'c': 8, 'v': 9, 'b': 11, 'q': 12, 'w': 13,
    'e': 14, 'r': 15, 'y': 16, 't': 17, '1': 18, '2': 19, '3': 20, '4': 21, '6': 22, '5': 23, '=': 24, '9': 25,
    '7': 26, '-': 27, '8': 28, '0': 29, ']': 30, 'o': 31, 'u': 32, '[': 33, 'i': 34, 'p': 35, 'l': 37, 'j': 38,
    "'": 39, 'k': 40, ';': 41, '\\': 42, ',': 43, '/': 44, 'n': 45, 'm': 46, '.': 47, '`': 50,
    'enter': 36, 'return': 36, 'tab': 48, 'space': 49, 'backspace': 51, 'delete': 51, 'escape': 53, 'esc': 53,
    'forwarddelete': 117, 'home': 115, 'end': 119, 'pageup': 116, 'pagedown': 121,
    'left': 123, 'right': 124, 'down': 125, 'up': 126,
    'f1': 122, 'f2': 120, 'f3': 99, 'f4': 118, 'f5': 96, 'f6': 97, 'f7': 98, 'f8': 100, 'f9': 101,
    'f10': 109, 'f11': 103, 'f12': 111,
}


def post(event):
    if not event:
        raise RuntimeError('CoreGraphics refused to create the event')
    try:
        if not DRY_RUN:
            CG.CGEventPost(HID_TAP, event)
    finally:
        CF.CFRelease(event)


def mouse(kind, x, y, button=0, clicks=None, flags=0):
    event = CG.CGEventCreateMouseEvent(None, kind, CGPoint(x, y), button)
    if clicks is not None and event:
        CG.CGEventSetIntegerValueField(event, CLICK_STATE, clicks)
    if flags and event:
        CG.CGEventSetFlags(event, flags)
    post(event)


def click(x, y, button='left', count=1):
    down, up, _dragged, code = MOUSE[button]
    mouse(MOVED, x, y)
    time.sleep(0.05)
    for n in range(1, count + 1):
        mouse(down, x, y, code, n)
        mouse(up, x, y, code, n)
        time.sleep(0.06)


def drag(x, y, x2, y2):
    down, up, dragged, code = MOUSE['left']
    mouse(MOVED, x, y)
    mouse(down, x, y, code, 1)
    steps = 12
    for i in range(1, steps + 1):
        mouse(dragged, x + (x2 - x) * i / steps, y + (y2 - y) * i / steps, code)
        time.sleep(0.015)
    mouse(up, x2, y2, code, 1)


def key_combo(keys):
    names = [str(k).lower().strip() for k in keys]
    flags = 0
    main = None
    for name in names:
        if name in FLAGS:
            flags |= FLAGS[name]
        elif name in KEYS:
            main = KEYS[name]
        else:
            raise ValueError(f'Unknown key: {name}')
    if main is None:
        raise ValueError('A key combination needs one non-modifier key')
    for is_down in (True, False):
        event = CG.CGEventCreateKeyboardEvent(None, main, is_down)
        if event:
            CG.CGEventSetFlags(event, flags)
        post(event)


def type_text(text):
    units = text.encode('utf-16-le')
    codes = [int.from_bytes(units[i:i + 2], 'little') for i in range(0, len(units), 2)]
    for start in range(0, len(codes), 16):
        chunk = codes[start:start + 16]
        buffer = (ctypes.c_uint16 * len(chunk))(*chunk)
        for is_down in (True, False):
            event = CG.CGEventCreateKeyboardEvent(None, 0, is_down)
            if event:
                CG.CGEventKeyboardSetUnicodeString(event, len(chunk), buffer)
            post(event)
        time.sleep(0.01)


def scroll(x, y, amount):
    mouse(MOVED, x, y)
    # Positive amount scrolls down, which CoreGraphics expresses as a negative wheel delta.
    post(CG.CGEventCreateScrollWheelEvent2(None, 1, 1, -int(amount), 0, 0))


def handle(command):
    op = command.get('op')
    number = lambda name: float(command[name])
    if op == 'click':
        click(number('x'), number('y'), command.get('button', 'left'), int(command.get('count', 1)))
    elif op == 'move':
        mouse(MOVED, number('x'), number('y'))
    elif op == 'drag':
        drag(number('x'), number('y'), number('x2'), number('y2'))
    elif op == 'type':
        type_text(str(command.get('text', '')))
    elif op == 'key':
        key_combo(command.get('keys') or [])
    elif op == 'scroll':
        scroll(number('x'), number('y'), number('amount'))
    else:
        raise ValueError(f'Unknown op: {op}')


def main():
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            handle(json.loads(line))
            reply = {'ok': True, 'dry_run': DRY_RUN}
        except Exception as error:  # noqa: BLE001 - every failure goes back to Kelus as a reply
            reply = {'ok': False, 'error': str(error)}
        sys.stdout.write(json.dumps(reply) + '\n')
        sys.stdout.flush()


if __name__ == '__main__':
    main()
