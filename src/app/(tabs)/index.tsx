import { router } from 'expo-router';

import { Feed } from '@/components/feed';
import { SharePrompt } from '@/components/share-prompt';
import { SupportBanner } from '@/components/support-banner';
import { ThemedText } from '@/components/themed-text';
import { Button, EmptyState } from '@/components/ui';
import { cornerFeed } from '@/lib/posts';

export default function CornerFeedScreen() {
  return (
    <Feed
      withTabBar
      loadPage={(page, loaded) => cornerFeed(page === 0 ? undefined : loaded.at(-1)?.published_at)}
      header={
        <>
          <ThemedText type="subtitle">Your Corner</ThemedText>
          <SupportBanner />
          <SharePrompt audience="corner" />
        </>
      }
      empty={
        <EmptyState
          title="Nothing here yet"
          body="Posts from the people in your Corner will show up here. Add someone by their username to get started.">
          <Button label="Find people" onPress={() => router.push('/search')} />
        </EmptyState>
      }
    />
  );
}
