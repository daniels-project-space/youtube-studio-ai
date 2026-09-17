"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useOwnerId } from "@/lib/owner-context";
import { useOperationsAccess } from "@/components/OperationsAccess";
import type { ChildAgeBandLabel } from "@/lib/childrenReviewIntake";
import styles from "./children-review.module.css";

type Intake = {
  _id: Id<"childrenReviewIntakes">;
  channelName: string;
  ageBand: ChildAgeBandLabel;
  learningObjective: string;
  curriculumDraft: string;
  showBibleDraft: string;
  readyForReview: boolean;
  updatedAt: number;
};

const EMPTY = {
  channelName: "",
  ageBand: "preschool" as ChildAgeBandLabel,
  learningObjective: "",
  curriculumDraft: "",
  showBibleDraft: "",
};

export default function ChildrenReviewPage() {
  return <Suspense fallback={<div className={styles.page}>Opening private review desk…</div>}><ChildrenReviewDesk /></Suspense>;
}

function ChildrenReviewDesk() {
  const ownerId = useOwnerId();
  const access = useOperationsAccess();
  const searchParams = useSearchParams();
  const drafts = useQuery(api.childrenReviewIntakes.listMine, access === "owner" ? { ownerId } : "skip") as Intake[] | undefined;
  const saveMine = useMutation(api.childrenReviewIntakes.saveMine);
  const [intakeId, setIntakeId] = useState<Id<"childrenReviewIntakes"> | undefined>();
  const [form, setForm] = useState(() => ({
    ...EMPTY,
    channelName: (searchParams.get("channelName") ?? "").slice(0, 120),
  }));
  const [savedStatus, setSavedStatus] = useState<"draft" | "ready_for_review" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const edit = (key: keyof typeof EMPTY, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSavedStatus(null);
    setMessage("");
  };

  const select = (draft: Intake) => {
    setIntakeId(draft._id);
    setForm({
      channelName: draft.channelName,
      ageBand: draft.ageBand,
      learningObjective: draft.learningObjective,
      curriculumDraft: draft.curriculumDraft,
      showBibleDraft: draft.showBibleDraft,
    });
    setSavedStatus(draft.readyForReview ? "ready_for_review" : "draft");
    setMessage("");
  };

  const save = async (readyForReview: boolean) => {
    if (access !== "owner" || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const id = await saveMine({ ownerId, intakeId, ...form, readyForReview });
      setIntakeId(id);
      setSavedStatus(readyForReview ? "ready_for_review" : "draft");
      setMessage(readyForReview
        ? "Saved for child-editor handoff. No review, approval, notification, render, or release has occurred."
        : "Private draft saved. Child-editor review is still required.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Draft could not be saved");
    } finally {
      setBusy(false);
    }
  };

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><small>CHILDREN’S LEARNING · PRIVATE INTAKE</small><h1>Review handoff</h1><p>Shape an original show and one learning objective. A real child editor must approve the later structured episode packets.</p></div>
      <Link href="/channels/new">Back to channels</Link>
    </header>

    <div className={styles.layout}>
      <section className={styles.card} aria-label="Children's show review draft">
        <div className={styles.cardHeader}><div><small>01 / concept packet</small><h2>{intakeId ? "Edit saved draft" : "New draft"}</h2></div><span>{savedStatus === "ready_for_review" ? "Ready for editor" : savedStatus === "draft" ? "Saved draft" : "Not saved"}</span></div>
        <label>Channel / show name<input value={form.channelName} maxLength={120} onChange={(event) => edit("channelName", event.target.value)} placeholder="An original learning show" /></label>
        <label>Age band<select value={form.ageBand} onChange={(event) => edit("ageBand", event.target.value)}><option value="toddler">Toddler · 2–3</option><option value="preschool">Preschool · 3–5</option><option value="early_primary">Early primary · 5–8</option></select></label>
        <label>One observable learning objective<input value={form.learningObjective} maxLength={240} onChange={(event) => edit("learningObjective", event.target.value)} placeholder="The child can identify…" /></label>
        <label>Curriculum draft<textarea value={form.curriculumDraft} maxLength={4000} rows={5} onChange={(event) => edit("curriculumDraft", event.target.value)} placeholder="Topic, source or curriculum basis, vocabulary, practice, and how a child demonstrates learning." /></label>
        <label>Show Bible draft<textarea value={form.showBibleDraft} maxLength={4000} rows={5} onChange={(event) => edit("showBibleDraft", event.target.value)} placeholder="Original recurring guide and world; familiar problem, guided attempt, varied repetition, participation, and recall." /></label>
        <p className={styles.hint}>Use original fictional characters. Do not include a real child’s name, contact details, or location.</p>
        {access === "owner" ? <div className={styles.actions}><button disabled={busy} onClick={() => void save(false)}>Save draft</button><button disabled={busy} className={styles.primary} onClick={() => void save(true)}>Mark ready for child editor</button></div>
          : <p className={styles.notice}>Owner access is required to open or save private review drafts.</p>}
        {message && <p className={styles.notice} role="status">{message}</p>}
      </section>

      <aside className={styles.side}>
        <section className={styles.card}><small>02 / review gate</small><h2>Not approved</h2><p>This desk stores a handoff draft only. It does not create a channel, generate a video, or authorize YouTube publishing.</p><ul><li>Child editor reviews the age band and one measurable objective.</li><li>Original world and characters need identity review.</li><li>Each episode later needs exact curriculum, graph, lesson, and safety receipts.</li></ul></section>
        <section className={styles.card}><small>SAVED PACKETS · LATEST 24</small><h2>Revisit a draft</h2>{drafts?.length ? <div className={styles.draftList}>{drafts.map((draft) => <button key={draft._id} onClick={() => select(draft)} data-active={intakeId === draft._id ? "true" : undefined}><strong>{draft.channelName}</strong><span>{draft.readyForReview ? "Ready for editor · not approved" : "Draft · not reviewed"}</span></button>)}</div> : <p>{drafts === undefined && access === "owner" ? "Loading drafts…" : "No saved drafts yet."}</p>}</section>
      </aside>
    </div>
  </div>;
}
