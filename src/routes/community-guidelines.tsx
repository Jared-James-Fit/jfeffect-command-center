import { createFileRoute } from "@tanstack/react-router";
import { SalesPageShell } from "@/components/sales/sales-page-shell";
import { Block, Heading } from "@/components/sales/apple";
import { CrewGuidelines } from "@/components/community/crew-rules-sheet";
import { shareMeta } from "@/lib/share-meta";

const TITLE = "Community guidelines | JF Effect";
const DESCRIPTION = "How Crew works: zero tolerance for hate, harassment, threats and sexual content, and how to report or block. Part of the JF Effect Terms of Service.";

/**
 * The Crew community guidelines, public: sign-up's box links here (they're
 * agreed to with the Terms when the account is made), and Settings shows the
 * same words in a sheet (CrewGuidelinesSheet).
 */
export const Route = createFileRoute("/community-guidelines")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      ...shareMeta({ title: "JF Effect Community Guidelines", description: DESCRIPTION, path: "/community-guidelines" }),
    ],
  }),
  component: CommunityGuidelinesPage,
});

function CommunityGuidelinesPage() {
  return (
    <SalesPageShell pageId="community-guidelines">
      <Block narrow>
        <Heading align="left" title="Community guidelines" sub="Crew is a place to train and cheer each other on." />
        <div className="rounded-2xl bg-card p-5 ring-1 ring-border/70 md:p-6">
          <CrewGuidelines tone="page" />
        </div>
      </Block>
    </SalesPageShell>
  );
}
