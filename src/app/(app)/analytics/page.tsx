import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { IconAnalytics } from "@/components/icons";

export default function AnalyticsPage() {
  return (
    <>
      <PageHeader title="Analytics" subtitle="Views, watch time, and channel growth" />
      <EmptyState
        title="Coming in the next build"
        description="YouTube performance metrics and per-channel trends, refreshed on a schedule."
        icon={<IconAnalytics width={24} height={24} />}
      />
    </>
  );
}
