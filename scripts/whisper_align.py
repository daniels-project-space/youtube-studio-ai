#!/usr/bin/env python3
# Local forced alignment: audio -> word timestamps (ms) via OpenAI Whisper.
import whisper, sys, json
model = whisper.load_model("base")
r = model.transcribe(sys.argv[1], word_timestamps=True, language="en", fp16=False)
words = []
for seg in r.get("segments", []):
    for w in seg.get("words", []):
        words.append({"text": w["word"].strip(),
                      "start": round(w["start"] * 1000),
                      "end": round(w["end"] * 1000)})
json.dump(words, open(sys.argv[2], "w"))
print(len(words))
