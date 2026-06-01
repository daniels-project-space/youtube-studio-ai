import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { IconSeo } from "@/components/icons";

export default function SeoPage() {
  return (
    <>
      <PageHeader title="SEO" subtitle="Title, tag, and keyword research" />
      <EmptyState
        title="Coming in the next build"
        description="A research engine for titles, tags, and keywords to boost discoverability."
        icon={<IconSeo width={24} height={24} />}
      />
    </>
  );
}
