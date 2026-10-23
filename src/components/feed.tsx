import { useFocusEffect } from 'expo-router';
import { useCallback, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PostCard } from '@/components/post-card';
import { ThemedView } from '@/components/themed-view';
import { ErrorText } from '@/components/ui';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import type { FeedPost } from '@/lib/posts';

/**
 * Loads one page. `pageIndex` starts at 0; `loaded` is everything shown so
 * far, for feeds that page by the last post's time.
 */
export type PageLoader = (pageIndex: number, loaded: FeedPost[]) => Promise<FeedPost[]>;

/** A paged list of posts that refreshes whenever its screen comes into focus. */
export function Feed({
  loadPage,
  header,
  empty,
  withTabBar = false,
}: {
  loadPage: PageLoader;
  header?: ReactElement;
  empty: ReactElement;
  withTabBar?: boolean;
}) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = useRef({ page: 0, done: false, loadingMore: false });
  const loadRef = useRef(loadPage);
  useLayoutEffect(() => {
    loadRef.current = loadPage;
  });

  const refresh = useCallback(async () => {
    try {
      const first = await loadRef.current(0, []);
      state.current = { page: 0, done: first.length === 0, loadingMore: false };
      setPosts(dedupe(first));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  async function loadMore() {
    const s = state.current;
    if (s.done || s.loadingMore || !posts.length) return;
    s.loadingMore = true;
    try {
      const next = await loadRef.current(s.page + 1, posts);
      s.page += 1;
      if (!next.length) s.done = true;
      setPosts((current) => dedupe([...current, ...next]));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      s.loadingMore = false;
    }
  }

  async function onPullToRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={withTabBar ? ['top', 'left', 'right'] : ['left', 'right']}>
        <FlatList
          data={posts}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <PostCard
              post={item}
              onDeleted={(id) => setPosts((current) => current.filter((p) => p.id !== id))}
            />
          )}
          ListHeaderComponent={
            <View style={styles.header}>
              {header}
              <ErrorText message={error} />
            </View>
          }
          ListEmptyComponent={loaded ? empty : <ActivityIndicator />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullToRefresh} />}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: (withTabBar ? BottomTabInset : 0) + Spacing.five },
          ]}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function dedupe(posts: FeedPost[]) {
  const seen = new Set<string>();
  return posts.filter((p) => !seen.has(p.id) && seen.add(p.id));
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { gap: Spacing.three },
  content: {
    gap: Spacing.three,
    padding: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
});
