/** Live project-owned registrations; update only with an explicit new Engine workflow. */
export const STUDIO_ENGINE_PROJECT = "youtube-studio-render";
export const STUDIO_ENGINE_BUCKET = "re-youtube-studio-render-p2w18g596q";
export const STUDIO_ENGINE_ZIMAGE_WORKFLOW = {
  workflowId: "jn739qpstjjme9afp2zw3a07dh8g580s",
  profileRevisionSha256: "c5fa2752adcbefa3f28ac80eba06335e841c05e0d5bd1bb694c414cdd8488b1b",
} as const;
export const STUDIO_ENGINE_AUDIO_WORKFLOWS = {
  yue2: {
    workflowId: "jn7317xe2gbj997hcrq91cjsrh8g52n2",
    profileRevisionSha256: "09bb07229366b5fa47fd8462e2834b4b9eee283e02cf49c0233630b1d79b0832",
  },
  "qwen3-tts": {
    workflowId: "jn799fshgrnb2qkc2326zec5518g53q3",
    profileRevisionSha256: "0a78001cc82ccfd2e19fa2930c5ee174c5f46df997c5657082305bb671b49d2a",
  },
  "minimax-music3": {
    workflowId: "jn77p3yvp7q863wnvcvbw6vs7x8g40ty",
    profileRevisionSha256: "72db6c53834ff62ff7b1892d553a86b86a61d9b3649920b5a8d9f2115d03acfd",
  },
  "fish-audio-s2-pro": {
    workflowId: "jn7cw38gsqzbmxgyy48pptn96h8g5vmv",
    profileRevisionSha256: "15a43637436a1307049a3441d3009d7f15a5b36760a6f486a04415bc2d4ba842",
  },
} as const;
