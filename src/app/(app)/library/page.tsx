import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { IconLibrary } from "@/components/icons";

export default function LibraryPage() {
  return (
    <>
      <PageHeader title="Library" subtitle="Finished videos and media assets" />
      <EmptyState
        title="Coming in the next build"
        description="Your published videos, thumbnails, and rendered assets will live here — browseable per channel."
        icon={<IconLibrary width={24} height={24} />}
      />
    </>
  );
}
