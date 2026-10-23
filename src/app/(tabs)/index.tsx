import { router } from 'expo-router';

import { Button, EmptyState, Screen } from '@/components/ui';

// Corner feed. Posts arrive in Phase 2; for now this points people to building
// their Corner.
export default function CornerFeedScreen() {
  return (
    <Screen title="Your Corner" withTabBar>
      <EmptyState
        title="Nothing here yet"
        body="Posts from the people in your Corner will show up here. Add someone by their username to get started.">
        <Button label="Find people" onPress={() => router.push('/search')} />
      </EmptyState>
    </Screen>
  );
}
