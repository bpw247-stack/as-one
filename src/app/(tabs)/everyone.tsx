import { Feed } from '@/components/feed';
import { SharePrompt } from '@/components/share-prompt';
import { SupportBanner } from '@/components/support-banner';
import { ThemedText } from '@/components/themed-text';
import { EmptyState } from '@/components/ui';
import { everyoneFeed } from '@/lib/posts';

export default function EveryoneFeedScreen() {
  return (
    <Feed
      withTabBar
      loadPage={(page) => everyoneFeed(page)}
      header={
        <>
          <ThemedText type="subtitle">Everyone</ThemedText>
          <SupportBanner />
          <SharePrompt audience="everyone" />
        </>
      }
      empty={
        <EmptyState
          title="Nothing here yet"
          body="Public and anonymous posts from everyone on As One will show up here, newest first."
        />
      }
    />
  );
}
