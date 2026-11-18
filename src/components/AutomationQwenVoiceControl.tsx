"use client";

import { useState } from "react";
import { QWEN3_TTS_SPEAKERS } from "@/engine/qwenTtsProfiles";
import { assertAutomationVoiceSaved, automationQwenVoiceChange } from "@/lib/automationQwenVoice";

export function AutomationQwenVoiceControl({ channelId, config, current, saveConfig }: {
  channelId: string;
  config: Record<string, unknown>;
  current: string;
  saveConfig: (input: { config: Record<string, unknown>; expectedConfigFence: string }) => Promise<{ state?: string }>;
}) {
  const [choice, setChoice] = useState({ channelId, current, selection: current });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ channelId: string; text: string } | null>(null);
  const selection = choice.channelId === channelId && choice.current === current ? choice.selection : current;
  const message = notice?.channelId === channelId ? notice.text : null;

  const save = async () => {
    if (!selection || !(QWEN3_TTS_SPEAKERS as readonly string[]).includes(selection)) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await saveConfig(automationQwenVoiceChange(config, selection));
      assertAutomationVoiceSaved(result);
      setNotice({ channelId, text: "Voice saved in channel settings. Listen to a sample before marking this channel ready." });
    } catch (error) {
      setNotice({ channelId, text: error instanceof Error ? error.message : "Could not save the voice." });
    } finally {
      setBusy(false);
    }
  };

  return <>
    <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
      <select aria-label="Qwen narration voice" value={selection} disabled={busy} onChange={(event) => setChoice({ channelId, current, selection: event.target.value })}>
        <option value="">Select a Qwen voice</option>
        {QWEN3_TTS_SPEAKERS.map((speaker) => <option key={speaker} value={speaker}>{speaker}</option>)}
      </select>
      <button type="button" onClick={save} disabled={busy || !selection || selection === current}>Save voice</button>
    </div>
    {!current && <div>Choose and save a Qwen voice before running narration. The saved legacy voice has not been changed.</div>}
    {message && <div role="status">{message}</div>}
  </>;
}
