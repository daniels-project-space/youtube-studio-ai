"use client";
import { useEffect, useRef, useState } from "react";
import { YUE2_AUDITION_CHECKS, type YuE2AuditionRecord, type YuE2AuditionSubmission } from "@/engine/yue2Audition";
import type { YuE2CandidateReview } from "@/lib/yue2ReviewTypes";
import styles from "./YuE2EvaluationPanel.module.css";

const label = (value: string) => value.replaceAll("_", " ");
const checkLabels = {
  channel_personality_fit: "Channel personality fit", arrangement_fidelity: "Arrangement fidelity",
  instrumental_only: "Instrumental, no vocals", perceptual_artifacts: "Free from audible artifacts",
  repetition: "Intentional repetition", ending: "Ending fits the brief", listening_quality: "Overall listening quality",
};
export function YuE2AuditionForm({ runId, review }: { runId: string; review: YuE2CandidateReview }) {
  const [saved, setSaved] = useState<YuE2AuditionRecord | null>(review.audition ?? null);
  const [draft, setDraft] = useState<YuE2AuditionSubmission>(() => ({
    candidateSha256: review.candidateSha256, verdict: saved?.verdict ?? "needs_work",
    listenedEntireSource: saved?.listenedEntireSource ?? false,
    checks: saved?.checks ?? Object.fromEntries(YUE2_AUDITION_CHECKS.map(key => [key, "unreviewed"])) as YuE2AuditionSubmission["checks"],
    sections: saved?.sections ?? review.arrangement.sections.map(section => ({ id: section.id, judgment: "unreviewed", notes: "" })),
    notes: saved?.notes ?? "",
  }));
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
  const promising = review.quality.status !== "blocked" && review.brief.contextRetained && draft.listenedEntireSource &&
    Object.values(draft.checks).every(value => value === "pass") && draft.sections.every(section => section.judgment === "pass" && section.notes.trim());
  const approving = draft.verdict === "approved_for_assembly";
  const approvalAvailable = review.sourceApprovalAvailable && /^[a-f0-9]{64}$/u.test(review.sourceApprovalBasisFingerprint ?? "");
  return <form className={styles.audition} aria-label="YuE audition record" onSubmit={async event => {
    event.preventDefault();
    if (busy) return;
    const requestController = new AbortController(); controller.current = requestController;
    setBusy(true); setMessage("");
    const timer = window.setTimeout(() => requestController.abort(), 120_000);
    try {
      const response = await fetch("/api/yue2-evaluations/review", { method: "POST", signal: requestController.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, audition: draft,
          ...(approving ? { sourceApprovalBasisFingerprint: review.sourceApprovalBasisFingerprint } : {}) }) });
      if (!response.ok) throw new Error(response.status === 409 ? "Candidate changed or audition incomplete. Reload review." : "Audition could not be saved. Reload before retrying.");
      const body = await response.json() as { ok?: boolean; audition?: YuE2AuditionRecord };
      if (!body.ok || !body.audition || body.audition.candidateSha256 !== review.candidateSha256 ||
        body.audition.verdict !== draft.verdict || body.audition.productionApproved !== false) throw new Error("Invalid save response. Reload review.");
      if (approving && !/^[a-f0-9]{64}$/u.test(body.audition.sourceApprovalFingerprint ?? "")) throw new Error("Source approval was not confirmed. Reload review.");
      if (!requestController.signal.aborted) { setSaved(body.audition); setMessage(approving
        ? "Source approved. Assembly remains paused; publishing is not authorized."
        : "Audition saved. Production approval remains pending."); }
    } catch (error) {
      if (controller.current === requestController) setMessage(requestController.signal.aborted
        ? "Save timed out. Reload to check whether it was recorded." : error instanceof Error ? error.message : "Save failed.");
    } finally {
      window.clearTimeout(timer);
      if (controller.current === requestController) { setBusy(false); controller.current = null; }
    }
  }}>
    <h3>Owner audition</h3>
    {saved && <p>Last saved: {label(saved.verdict)} / {new Date(saved.reviewedAt).toLocaleString()}</p>}
    {saved?.verdict === "approved_for_assembly" && !saved.sourceApprovalFingerprint && <p>Previous source approval is no longer active for this pipeline.</p>}
    <fieldset disabled={busy}>
      <label><input type="checkbox" checked={draft.listenedEntireSource} onChange={event => setDraft({ ...draft, listenedEntireSource: event.target.checked })} /> Listened to the entire native source</label>
      {YUE2_AUDITION_CHECKS.map(key => <label key={key}>{checkLabels[key]}
        <select aria-label={checkLabels[key]} value={draft.checks[key]} onChange={event => setDraft({ ...draft, checks: { ...draft.checks, [key]: event.target.value as "pass" | "fail" | "unreviewed" } })}>
          <option value="unreviewed">Unreviewed</option><option value="pass">Pass</option><option value="fail">Fail</option>
        </select>
      </label>)}
      {draft.sections.map((section, index) => <div key={section.id}>
        <label>{review.arrangement.sections[index].label}
          <select aria-label={`${review.arrangement.sections[index].label} judgment`} value={section.judgment} onChange={event => setDraft({ ...draft,
            sections: draft.sections.map((item, i) => i === index ? { ...item, judgment: event.target.value as "pass" | "fail" | "unreviewed" } : item) })}>
            <option value="unreviewed">Unreviewed</option><option value="pass">Pass</option><option value="fail">Fail</option>
          </select>
        </label>
        <label>Section observations<textarea aria-label={`${review.arrangement.sections[index].label} observations`} maxLength={600} value={section.notes} onChange={event => setDraft({ ...draft,
          sections: draft.sections.map((item, i) => i === index ? { ...item, notes: event.target.value } : item) })} /></label>
      </div>)}
      <label>Audition notes<textarea aria-label="Audition notes" required minLength={10} maxLength={4000} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label>
      <label>Verdict<select aria-label="Verdict" value={draft.verdict} onChange={event => setDraft({ ...draft, verdict: event.target.value as YuE2AuditionSubmission["verdict"] })}>
        <option value="needs_work">Needs work</option><option value="rejected">Rejected</option><option value="promising" disabled={!promising}>Promising, not production-approved</option>
        <option value="approved_for_assembly" disabled={!promising || !approvalAvailable}
          title={!approvalAvailable ? "Verified source and frozen pipeline invocation required" : !promising ? "Complete the full-source audition first" : "Approve this source only, not publishing"}>Approve source for assembly</option>
      </select></label>
      <button type="submit" disabled={draft.notes.trim().length < 10 || (["promising", "approved_for_assembly"].includes(draft.verdict) && !promising)
        || (approving && !approvalAvailable)}>{busy ? "Saving audition..." : "Save audition"}</button>
    </fieldset>
    {message && <p role="status">{message}</p>}
  </form>;
}
