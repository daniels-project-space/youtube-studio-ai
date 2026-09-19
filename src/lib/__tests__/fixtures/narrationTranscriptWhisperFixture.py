"""Guard only Whisper transport; execute the real proof producer unchanged."""
import importlib.metadata
import json
import os
import runpy
import socket
import sys
import types

fixture = json.loads(os.environ["NARRATION_PROOF_TEST_FIXTURE"])
calls = {"model": 0, "transcribe": 0, "network": 0}


def deny_network(*args, **kwargs):
    calls["network"] += 1
    raise RuntimeError("narration proof fixture forbids network")


socket.socket.connect = deny_network
socket.create_connection = deny_network
original_version = importlib.metadata.version
importlib.metadata.version = lambda package: (
    "1.2.1" if package == "faster-whisper" else original_version(package)
)


class WhisperFixture:
    def __init__(self, model_dir, **kwargs):
        assert os.path.isdir(model_dir)
        assert kwargs == {"device": "cpu", "compute_type": "int8"}
        calls["model"] += 1

    def transcribe(self, audio_path, **kwargs):
        assert os.path.isfile(audio_path)
        assert kwargs == {
            "language": "en", "task": "transcribe", "beam_size": 5,
            "word_timestamps": True, "vad_filter": True,
            "condition_on_previous_text": True,
        }, kwargs
        calls["transcribe"] += 1
        return iter([
            types.SimpleNamespace(
                text=segment["text"],
                words=[types.SimpleNamespace(
                    word=word["text"], start=word["start"], end=word["end"],
                ) for word in segment["words"]],
            ) for segment in fixture["segments"]
        ]), types.SimpleNamespace(language="en")


transport = types.ModuleType("faster_whisper")
transport.WhisperModel = WhisperFixture
sys.modules["faster_whisper"] = transport
script = sys.argv[1]
sys.argv = [script, *sys.argv[2:]]
namespace = None
try:
    if "tokenVectors" in fixture:
        namespace = runpy.run_path(script, run_name="fixture_token_policy")
        print(json.dumps([namespace["tokens"](text) for text in fixture["tokenVectors"]]))
    else:
        namespace = runpy.run_path(script, run_name="__main__")
finally:
    print(json.dumps({"fixtureCalls": calls}), file=sys.stderr)
