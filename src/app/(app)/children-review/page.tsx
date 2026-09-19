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
  const owner = access === "owner";
  const briefCompletion = [
    form.channelName,
    form.learningObjective,
    form.curriculumDraft,
    form.showBibleDraft,
  ].filter((value) => value.trim().length > 0).length;

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
    if (!owner || busy) return;
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
      <div><small>CHILDREN’S LEARNING · PRIVATE</small><h1>Learning draft</h1><p>One show, one measurable outcome, then child-editor review.</p></div>
      <Link href="/channels/new">New channel</Link>
    </header>

    <div className={styles.layout}>
      <section className={styles.card} aria-label="Children's show review draft">
        <div className={styles.cardHeader}><div><small>01 / SHOW BRIEF</small><h2>{intakeId ? "Edit draft" : "New draft"}</h2></div><div className={styles.statusGroup}><span>{briefCompletion}/4 complete</span><span>{savedStatus === "ready_for_review" ? "Editor review" : savedStatus === "draft" ? "Saved" : "Private"}</span></div></div>
        <div className={styles.formGrid}>
          <label>Show name<input disabled={!owner} value={form.channelName} maxLength={120} onChange={(event) => edit("channelName", event.target.value)} placeholder="Original learning show" /></label>
          <label>Age band<select disabled={!owner} value={form.ageBand} onChange={(event) => edit("ageBand", event.target.value)}><option value="toddler">Toddler · 2–3</option><option value="preschool">Preschool · 3–5</option><option value="early_primary">Early primary · 5–8</option></select></label>
          <label className={styles.wideField}>Learning outcome<input disabled={!owner} value={form.learningObjective} maxLength={240} onChange={(event) => edit("learningObjective", event.target.value)} placeholder="A child can identify…" /></label>
        </div>
        <div className={styles.detailStack}>
          <details open>
            <summary><span>Curriculum evidence</span><small>{form.curriculumDraft.trim() ? "Added" : "Required"}</small></summary>
            <label className={styles.detailLabel}>Topic, source, vocabulary, practice, and observable result<textarea disabled={!owner} value={form.curriculumDraft} maxLength={4000} rows={4} onChange={(event) => edit("curriculumDraft", event.target.value)} placeholder="Topic, source, vocabulary, practice, and the observable result." /></label>
          </details>
          <details>
            <summary><span>Show bible</span><small>{form.showBibleDraft.trim() ? "Added" : "Required"}</small></summary>
            <label className={styles.detailLabel}>Original guide, world, participation, and recall<textarea disabled={!owner} value={form.showBibleDraft} maxLength={4000} rows={4} onChange={(event) => edit("showBibleDraft", event.target.value)} placeholder="Original guide, world, recurring problem, participation, and recall." /></label>
          </details>
        </div>
        <p className={styles.hint}>Use original fictional characters. Never include a child’s personal details.</p>
        {owner ? <div className={styles.actions}><button disabled={busy} onClick={() => void save(false)}>Save draft</button><button disabled={busy} className={styles.primary} onClick={() => void save(true)}>Send to child editor</button></div>
          : <p className={styles.notice}>Sign in as the workspace owner to save a private review draft.</p>}
        {message && <p className={styles.notice} role="status">{message}</p>}
      </section>

      <aside className={styles.side}>
        <section className={styles.card}><small>02 / REVIEW</small><h2>Private by design</h2><ul className={styles.checklist}><li><span>01</span>Age-fit outcome</li><li><span>02</span>Original world</li><li><span>03</span>Curriculum proof</li></ul><p>This desk only saves a private handoff. It never creates, renders, or releases a channel.</p></section>
        <section className={styles.card}><small>SAVED DRAFTS · LATEST 24</small><h2>Continue a draft</h2>{drafts?.length ? <div className={styles.draftList}>{drafts.map((draft) => <button key={draft._id} onClick={() => select(draft)} data-active={intakeId === draft._id ? "true" : undefined}><strong>{draft.channelName}</strong><span>{draft.readyForReview ? "Editor review · private" : "Draft · private"}</span></button>)}</div> : <p>{drafts === undefined && access === "owner" ? "Loading drafts…" : "No saved drafts yet."}</p>}</section>
      </aside>
    </div>
  </div>;
}
