import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[1] / 'agent-engine'
sys.path.insert(0, str(ENGINE))

from kernel_bridge import to_output  # noqa: E402

KERNEL_PYTHON = os.environ.get('KELUS_TEST_KERNEL_PYTHON', sys.executable)


def has_jupyter(python):
    return subprocess.run([python, '-c', 'import jupyter_client, ipykernel'], capture_output=True).returncode == 0


class OutputConversionTests(unittest.TestCase):
    def test_stream(self):
        self.assertEqual(to_output('stream', {'name': 'stderr', 'text': 'x\n'}),
                         {'output_type': 'stream', 'name': 'stderr', 'text': 'x\n'})

    def test_execute_result_keeps_count_and_mime_bundle(self):
        output = to_output('execute_result', {'data': {'text/html': '<table/>', 'text/plain': 'df'}, 'metadata': {}, 'execution_count': 3})
        self.assertEqual(output['output_type'], 'execute_result')
        self.assertEqual(output['execution_count'], 3)
        self.assertEqual(output['data']['text/html'], '<table/>')

    def test_update_display_becomes_display_data(self):
        self.assertEqual(to_output('update_display_data', {'data': {}, 'metadata': {}})['output_type'], 'display_data')

    def test_error_and_unknown(self):
        error = to_output('error', {'ename': 'ZeroDivisionError', 'evalue': 'division by zero', 'traceback': ['tb']})
        self.assertEqual((error['output_type'], error['ename'], error['traceback']), ('error', 'ZeroDivisionError', ['tb']))
        self.assertIsNone(to_output('comm_open', {}))


@unittest.skipUnless(has_jupyter(KERNEL_PYTHON), 'jupyter_client/ipykernel not installed for the test interpreter')
class LiveKernelTests(unittest.TestCase):
    def test_runs_cells_and_aborts_queue_after_error(self):
        with tempfile.TemporaryDirectory() as cwd:
            bridge = subprocess.Popen([KERNEL_PYTHON, str(ENGINE / 'kernel_bridge.py'), '--cwd', cwd],
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
            try:
                for cell, code in (('a', 'import os\nprint(os.getcwd())\n40 + 2'), ('b', '1/0'), ('c', 'print("never")')):
                    bridge.stdin.write(json.dumps({'op': 'execute', 'cell': cell, 'code': code}) + '\n')
                bridge.stdin.flush()
                events, done = [], {}
                deadline = time.time() + 90
                while len(done) < 3 and time.time() < deadline:
                    line = bridge.stdout.readline()
                    if not line:
                        break
                    event = json.loads(line)
                    events.append(event)
                    if event['event'] == 'done':
                        done[event['cell']] = event['status']
                outputs = {}
                for event in events:
                    if event['event'] == 'output':
                        outputs.setdefault(event['cell'], []).append(event['output'])
                self.assertEqual(outputs['a'][0]['text'].strip(), os.path.realpath(cwd))
                self.assertEqual(outputs['a'][1]['data']['text/plain'], '42')
                self.assertEqual(outputs['b'][0]['ename'], 'ZeroDivisionError')
                self.assertEqual(done.get('c'), 'aborted')
                self.assertNotIn('c', outputs)
            finally:
                bridge.stdin.write(json.dumps({'op': 'shutdown'}) + '\n')
                bridge.stdin.close()
                bridge.wait(timeout=30)
                bridge.stdout.close()


if __name__ == '__main__':
    unittest.main()
