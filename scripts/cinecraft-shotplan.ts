import { bootstrapSecrets } from "@/lib/bootstrap";
import { geminiJsonPro } from "@/lib/gemini";
(async () => {
  await bootstrapSecrets();
  const narration = `Paris, 1925. A man is sitting in a luxury hotel suite counting hundreds of thousands of francs in cash. He just sold the Eiffel Tower and he never owned it. His name is Victor Lustig. Congratulations, Mr. Poisson. The tower is yours. He shakes hands, picks up his briefcase, walks out of the suite, down the corridor, through the lobby, onto the Paris streets. He hails a taxi, sits in the back with a briefcase full of cash, and he smiles.`;
  const plan = await geminiJsonPro<{ shots?: any[] }>({
    prompt: [
      "You are the DIRECTOR of a cinematic AI history-documentary (Cipher / ago. style). Turn this narration into a SHOT LIST.",
      "The recurring CHARACTER is Victor Lustig, a 35-year-old 1925 European con artist in a charcoal 1920s three-piece suit (a trained character reference exists — keep him identical every shot).",
      "Narration:\n\"" + narration + "\"",
      "Produce EXACTLY 4 cinematic shots for the opening. Each shot is one continuous ~5s beat. For each shot return:",
      "- id (1-4)",
      "- beat (the narration moment)",
      "- setting (period-accurate: 1925 Paris, hotel suite / corridor / street)",
      "- action (what Lustig physically does)",
      "- keyframePrompt (a Nano-Banana image prompt to render the START FRAME: Victor Lustig in the scene, period-accurate, cinematic — the character ref keeps his face/suit, so describe scene + pose + framing + lighting)",
      "- cameraMove (Higgsfield/cinematic camera direction: e.g. slow push-in, dolly, low-angle, handheld follow, crane)",
      "- lens (e.g. 35mm, 50mm, 85mm) and mood",
      "- i2vPrompt (the Seedance image-to-video motion prompt that animates the keyframe with the camera move + the action, ~5s)",
      "- transition (cut, match-cut, dip-to-black, whip)",
      "Return STRICT JSON {\"shots\":[{id,beat,setting,action,keyframePrompt,cameraMove,lens,mood,i2vPrompt,transition}]}.",
    ].join("\n\n"),
    maxTokens: 4000, temperature: 0.7,
  });
  console.log(JSON.stringify(plan, null, 1));
  const fs = await import("node:fs"); fs.writeFileSync("/tmp/shotplan.json", JSON.stringify(plan));
})();
