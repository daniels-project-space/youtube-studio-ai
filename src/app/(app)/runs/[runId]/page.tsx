"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { PageHeader, SectionTitle } from "@/components/PageHeader";
import { StageBadge } from "@/components/StageBadge";
import { Elapsed } from "@/components/Elapsed";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import { fmtDateTime, fmtUsd } from "@/lib/format";
import { IconExternal } from "@/components/icons";

type Stage = {
  _id: string;
  block: string;
  status: string;
  startedAt?: number;
  finishedAt?: number;
  cost: number;
  error?: string;
};

export default function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = use(params);

  const run = useQuery(api.runs.getRun, { runId: runId as Id<"runs"> });
  const stages = useQuery(api.runStages.listRunStages, {
    runId: runId as Id<"runs">,
  }) as Stage[] | undefined;

  if (run === undefined) {
    return (
      <>
        <PageHeader title="Run" />
        <SkeletonList rows={3} />
      </>
    );
  }

  if (run === null) {
    return (
      <>
        <PageHeader title="Run" />
        <EmptyState
          title="Run not found"
          description={
            <Link href="/runs" style={{ color: "var(--color-accent)" }}>
              Back to runs
            </Link>
          }
        />
      </>
    );
  }

  const live = run.status === "running" || run.status === "queued";
  const ordered = (stages ?? [])
    .slice()
    .sort((a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity));

  return (
    <>
      <PageHeader
        title="Run detail"
        subtitle={
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem" }}>
            {run._id}
          </span>
        }
        actions={<StageBadge status={run.status} />}
      />

      {/* Summary */}
      <section style={{ marginBottom: "2rem" }}>
        <div
          className="glass glass-shine"
          style={{
            padding: "1.25rem 1.4rem",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: "1.1rem",
          }}
        >
          <Field label="Started" value={fmtDateTime(run.startedAt)} />
          <Field label="Finished" value={run.finishedAt ? fmtDateTime(run.finishedAt) : "—"} />
          <Field
            label="Elapsed"
            value={<Elapsed from={run.startedAt} to={live ? undefined : run.finishedAt} />}
          />
          <Field label="Cost" value={fmtUsd(run.costTotal)} mono />
          <Field
            label="Video"
            value={
              run.youtubeVideoId ? (
                <a
                  href={`https://www.youtube.com/watch?v=${run.youtubeVideoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", color: "var(--color-secondary)" }}
                >
                  Watch <IconExternal width={13} height={13} />
                </a>
              ) : (
                "—"
              )
            }
          />
        </div>

        {run.error && (
          <div
            className="glass"
            style={{
              marginTop: "0.9rem",
              padding: "0.9rem 1.1rem",
              border: "1px solid color-mix(in srgb, var(--color-failed) 35%, transparent)",
              color: "var(--color-failed)",
              fontSize: "0.85rem",
              fontFamily: "var(--font-mono)",
              whiteSpace: "pre-wrap",
            }}
          >
            {run.error}
          </div>
        )}
      </section>

      {/* Stages (full live track ships in Tranche 2) */}
      <section>
        <SectionTitle>Stages</SectionTitle>
        {stages === undefined ? (
          <SkeletonList rows={3} />
        ) : ordered.length > 0 ? (
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {ordered.map((s) => (
              <div
                key={s._id}
                className="glass"
                style={{
                  padding: "0.8rem 1.1rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "1rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0 }}>
                  <StageBadge status={s.status} size="sm" />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>{s.block}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", fontSize: "0.78rem", color: "var(--color-faint)" }}>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{fmtUsd(s.cost)}</span>
                  <Elapsed
                    from={s.startedAt}
                    to={s.status === "running" ? undefined : s.finishedAt}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No stages recorded"
            description="The full live stage-track view arrives in the next build."
          />
        )}
      </section>
    </>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: "0.7rem",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--color-faint)",
          marginBottom: "0.3rem",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "0.95rem", fontFamily: mono ? "var(--font-mono)" : undefined }}>
        {value}
      </div>
    </div>
  );
}
