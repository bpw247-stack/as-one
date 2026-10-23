import { EmptyState, Screen } from '@/components/ui';

// Main feed: public named posts and anonymous posts, newest first. Arrives in Phase 2.
export default function EveryoneFeedScreen() {
  return (
    <Screen title="Everyone" withTabBar>
      <EmptyState
        title="Nothing here yet"
        body="Public and anonymous posts from everyone on As One will show up here, newest first."
      />
    </Screen>
  );
}
