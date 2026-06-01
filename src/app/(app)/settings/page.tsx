import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { IconSettings } from "@/components/icons";

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" subtitle="Owner, integrations, and defaults" />
      <EmptyState
        title="Coming in the next build"
        description="Manage YouTube OAuth, model routing, budgets, and channel defaults."
        icon={<IconSettings width={24} height={24} />}
      />
    </>
  );
}
