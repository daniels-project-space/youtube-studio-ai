"use client";

import { useCallback, useEffect, useRef, useState, type ComponentPropsWithRef, type SyntheticEvent } from "react";
import styles from "./SignedVideoPlayer.module.css";

const SIGNING_TIMEOUT_MS = 15_000;
const RESTORE_TIMEOUT_MS = 20_000;

/** Invalid/unsigned URLs are not evidence of expiry and never trigger automatic signing. */
export function signedVideoExpiresAt(src: string): number | null {
  try {
    const url = new URL(src, "https://asset.invalid");
    if (!/^https?:$/.test(url.protocol)) return null;
    const date = url.searchParams.get("X-Amz-Date") ?? "";
    const expires = url.searchParams.get("X-Amz-Expires") ?? "";
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(date);
    if (!match || !/^\d+$/.test(expires)) return null;
    const seconds = Number(expires);
    if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 604_800) return null;
    const instant = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`);
    if (!Number.isFinite(instant.getTime()) || instant.toISOString().replace(/[-:]|\.000/g, "") !== date) return null;
    return instant.getTime() + seconds * 1000;
  } catch { return null; }
}

/** A renewed receipt may change its signature, never its media origin/object path. */
export function sameSignedVideoObject(previous: string, next: string, base = "https://asset.invalid"): boolean {
  try {
    const a = new URL(previous, base), b = new URL(next, base);
    return /^https?:$/.test(a.protocol) && a.origin === b.origin && a.pathname === b.pathname;
  } catch { return false; }
}

type Snapshot = { time: number; playing: boolean; volume: number; muted: boolean; rate: number };
type Recovery = {
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  snapshot: Snapshot;
  target: string | null;
  restoreTime: number | null;
  explicitPlayDuringRestore?: boolean;
};
export type SignedVideoPlayerProps = Omit<ComponentPropsWithRef<"video">, "src" | "children"> & {
  assetKey: string;
  /** Already resolved initial URL. This component does not sign on mount. */
  src: string;
};

/** Each caller owns recovery; shared URL caches and sibling players are untouched. */
export function SignedVideoPlayer({ assetKey, src, ...props }: SignedVideoPlayerProps) {
  // An explicitly changed input starts a new source lifetime. Recovery changes
  // only inner state, so the native video node stays mounted during renewal.
  return <SignedVideoSession key={`${assetKey}\u0000${src}`} assetKey={assetKey} src={src} {...props} />;
}

function SignedVideoSession({
  assetKey, src, ref: forwardedRef, autoPlay,
  onError, onPlay, onPause, onSeeking, onSeeked, onStalled, onWaiting,
  onLoadedMetadata, onLoadedData, onCanPlay, onTimeUpdate, onEnded,
  onVolumeChange, onRateChange,
  ...nativeProps
}: SignedVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const source = useRef(src);
  const live = useRef(true);
  const operation = useRef<Recovery | null>(null);
  const attemptedSource = useRef<string | null>(null);
  const wantedPlay = useRef(Boolean(autoPlay));
  const suppressFailurePause = useRef(false);
  const lastPosition = useRef(0);
  const [activeSrc, setActiveSrc] = useState(src);
  const [phase, setPhase] = useState<"ready" | "recovering" | "error">("ready");
  const [hasRecovered, setHasRecovered] = useState(false);
  const [resumeNotice, setResumeNotice] = useState(false);
  const assignRef = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (typeof forwardedRef === "function") return forwardedRef(node);
    if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      const pending = operation.current;
      operation.current = null;
      if (pending) { clearTimeout(pending.timer); pending.controller.abort(); }
    };
  }, []);

  function rememberPosition(video: HTMLVideoElement) {
    // A failed load may zero currentTime. Do not erase the last decoded/seek position.
    if (Number.isFinite(video.currentTime) && (video.currentTime > 0 || !video.error)) lastPosition.current = video.currentTime;
  }
  function snapshot(video: HTMLVideoElement): Snapshot {
    rememberPosition(video);
    return { time: lastPosition.current, playing: wantedPlay.current && !video.ended,
      volume: video.volume, muted: video.muted, rate: video.playbackRate };
  }
  function fail(pending?: Recovery) {
    if (pending && operation.current !== pending) return;
    const current = operation.current;
    operation.current = null;
    if (current) { clearTimeout(current.timer); current.controller.abort(); }
    if (live.current) {
      // Cancel any outstanding native play() promise after a deadline. A late
      // network response must not start playback behind the terminal error UI.
      const video = videoRef.current;
      if (video && !video.paused) { suppressFailurePause.current = true; video.pause(); }
      setPhase("error");
    }
  }
  function finishRestore(video: HTMLVideoElement) {
    const pending = operation.current;
    if (!pending?.target || pending.restoreTime === null || video.currentSrc !== pending.target || video.readyState < 2 ||
        Math.abs(video.currentTime - pending.restoreTime) > 0.25) return;
    clearTimeout(pending.timer);
    operation.current = null;
    lastPosition.current = video.currentTime;
    video.volume = pending.snapshot.volume;
    video.muted = pending.snapshot.muted;
    video.playbackRate = pending.snapshot.rate;
    setPhase("ready");
    if (pending.snapshot.playing) {
      void video.play().catch(() => {
        if (live.current && videoRef.current === video && !video.error && wantedPlay.current &&
            source.current === pending.target && !operation.current) setResumeNotice(true);
      });
    } else video.pause();
  }
  function restoreMetadata(video: HTMLVideoElement) {
    const pending = operation.current;
    if (!pending?.target || video.currentSrc !== pending.target) return;
    video.volume = pending.snapshot.volume;
    video.muted = pending.snapshot.muted;
    video.playbackRate = pending.snapshot.rate;
    pending.restoreTime = Number.isFinite(video.duration)
      ? Math.min(pending.snapshot.time, Math.max(0, video.duration - 0.05)) : pending.snapshot.time;
    if (Math.abs(video.currentTime - pending.restoreTime) > 0.025) video.currentTime = pending.restoreTime;
    finishRestore(video);
  }
  function recover(manual = false): boolean {
    const video = videoRef.current;
    if (!live.current || !video || operation.current || !assetKey.trim()) return false;
    const expiresAt = signedVideoExpiresAt(source.current);
    if (!manual && (phase === "error" || expiresAt === null || expiresAt > Date.now() || attemptedSource.current === source.current)) return false;
    // Manual retry hides its focused button. The native node survives recovery;
    // automatic recovery must never steal keyboard focus.
    if (manual) video.focus({ preventScroll: true });
    attemptedSource.current = source.current;
    const pending: Recovery = {
      controller: new AbortController(), snapshot: snapshot(video), target: null, restoreTime: null,
      timer: setTimeout(() => fail(pending), SIGNING_TIMEOUT_MS),
    };
    operation.current = pending;
    setPhase("recovering");
    setHasRecovered(true);
    setResumeNotice(false);
    void (async () => {
      try {
        const response = await fetch(`/api/asset-url?key=${encodeURIComponent(assetKey)}`, {
          cache: "no-store", signal: pending.controller.signal,
        });
        if (!response.ok) throw new Error("Signing failed");
        const data: unknown = await response.json();
        const next = data && typeof data === "object" && "url" in data ? data.url : null;
        if (typeof next !== "string" || !next.trim() || !sameSignedVideoObject(source.current, next, window.location.href)) throw new Error("Invalid replacement source");
        const nextExpiry = signedVideoExpiresAt(next);
        if (nextExpiry !== null && nextExpiry <= Date.now()) throw new Error("Replacement already expired");
        if (!live.current || operation.current !== pending || videoRef.current !== video) return;
        pending.snapshot = snapshot(video); // Playback/user seeks may advance during signing.
        pending.target = new URL(next, window.location.href).href;
        // Native load() resets playbackRate to defaultPlaybackRate and emits
        // ratechange. Preserve the chosen rate through that reset as well.
        video.defaultPlaybackRate = pending.snapshot.rate;
        clearTimeout(pending.timer);
        pending.timer = setTimeout(() => fail(pending), RESTORE_TIMEOUT_MS);
        source.current = pending.target;
        // Signatures can be identical within one second. A manual retry must
        // reload the errored node even when React would see an unchanged src.
        if (new URL(activeSrc, window.location.href).href === pending.target) video.load();
        else setActiveSrc(pending.target);
      } catch { if (live.current && operation.current === pending) fail(pending); }
    })();
    return true;
  }
  function needsNetwork(video: HTMLVideoElement) {
    for (let index = 0; index < video.buffered.length; index++) {
      if (video.currentTime >= video.buffered.start(index) && video.currentTime < video.buffered.end(index)) {
        // A buffered seek briefly lowers readyState while decoding; it does
        // not need a new HTTP request or a replacement signed URL.
        return !video.seeking && video.readyState < 3;
      }
    }
    return true;
  }
  function onNetworkDemand(event: SyntheticEvent<HTMLVideoElement>) {
    const video = event.currentTarget;
    if ((wantedPlay.current || video.seeking) && needsNetwork(video)) recover();
  }

  return (
    <div className={styles.player} data-signed-video-state={phase}>
      <video
        {...nativeProps}
        ref={assignRef}
        src={activeSrc}
        // Native autoplay must not restart an intentionally paused player after src changes.
        autoPlay={autoPlay && !hasRecovered}
        onError={(event) => {
          const pending = operation.current;
          if (pending?.target && event.currentTarget.currentSrc === pending.target) fail(pending);
          else if (!pending && !recover()) fail();
          onError?.(event);
        }}
        onPlay={(event) => {
          wantedPlay.current = true; setResumeNotice(false);
          if (operation.current) {
            operation.current.snapshot.playing = true;
            if (operation.current.target) operation.current.explicitPlayDuringRestore = true;
          }
          if (needsNetwork(event.currentTarget)) recover();
          onPlay?.(event);
        }}
        onPause={(event) => {
          const pending = operation.current;
          // Loading a new src emits its own pause at HAVE_NOTHING. Decoded
          // pauses, or pause after an explicit play during this load, are user intent.
          if (suppressFailurePause.current) suppressFailurePause.current = false;
          else if (!event.currentTarget.error && (!pending?.target || event.currentTarget.readyState >= 2 || pending.explicitPlayDuringRestore)) {
            wantedPlay.current = false;
            if (pending) pending.snapshot.playing = false;
          }
          onPause?.(event);
        }}
        onSeeking={(event) => {
          if (!operation.current?.target) {
            rememberPosition(event.currentTarget);
            if (needsNetwork(event.currentTarget)) recover();
          }
          onSeeking?.(event);
        }}
        onSeeked={(event) => { finishRestore(event.currentTarget); onSeeked?.(event); }}
        onStalled={(event) => { onNetworkDemand(event); onStalled?.(event); }}
        onWaiting={(event) => { onNetworkDemand(event); onWaiting?.(event); }}
        onLoadedMetadata={(event) => { restoreMetadata(event.currentTarget); onLoadedMetadata?.(event); }}
        onLoadedData={(event) => { finishRestore(event.currentTarget); onLoadedData?.(event); }}
        onCanPlay={(event) => { finishRestore(event.currentTarget); onCanPlay?.(event); }}
        onTimeUpdate={(event) => { if (!operation.current?.target) rememberPosition(event.currentTarget); onTimeUpdate?.(event); }}
        onEnded={(event) => { wantedPlay.current = false; onEnded?.(event); }}
        onVolumeChange={(event) => {
          if (operation.current) {
            operation.current.snapshot.volume = event.currentTarget.volume;
            operation.current.snapshot.muted = event.currentTarget.muted;
          }
          onVolumeChange?.(event);
        }}
        onRateChange={(event) => {
          if (operation.current) operation.current.snapshot.rate = event.currentTarget.playbackRate;
          onRateChange?.(event);
        }}
      />
      {phase !== "ready" && (
        <div className={styles.notice} role="status" aria-live="polite">
          <span>{phase === "recovering" ? "Restoring video connection…" : "Video connection could not be restored."}</span>
          {phase === "error" && <button type="button" onClick={() => recover(true)}>Retry video</button>}
        </div>
      )}
      {resumeNotice && <div className={styles.notice} role="status">Video restored. Press play to resume.</div>}
    </div>
  );
}
