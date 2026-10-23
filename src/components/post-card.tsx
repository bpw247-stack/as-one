import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confirm, notify } from '@/lib/confirm';
import { deletePost, KIND_LABELS, type FeedPost } from '@/lib/posts';
import { anonymousTimeAgo, isPending, timeAgo } from '@/lib/time';

function audienceLabel(post: FeedPost) {
  if (post.is_anonymous) return 'Anonymous';
  if (post.to_corner && post.to_everyone) return 'Corner + Everyone';
  return post.to_corner ? 'Corner' : 'Everyone';
}

export function PostCard({ post, onDeleted }: { post: FeedPost; onDeleted?: (id: string) => void }) {
  const theme = useTheme();
  const pending = post.is_mine && isPending(post.published_at);
  const when = post.is_anonymous && !post.is_mine ? anonymousTimeAgo(post.published_at) : timeAgo(post.published_at);

  async function onDelete() {
    const ok = await confirm('Delete this post?', 'It will be removed for everyone.', 'Delete');
    if (!ok) return;
    try {
      await deletePost(post.id);
      onDeleted?.(post.id);
    } catch (e) {
      notify('Could not delete the post', e instanceof Error ? e.message : undefined);
    }
  }

  return (
    <Card>
      <View style={styles.meta}>
        <ThemedText type="smallBold" style={{ color: theme.accent }}>
          {KIND_LABELS[post.kind]}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          · {pending ? 'Posting in a few minutes' : when}
          {post.is_mine ? ` · ${audienceLabel(post)}` : ''}
        </ThemedText>
      </View>

      {post.is_anonymous ? (
        <ThemedText type="smallBold">
          {post.is_mine ? 'You, anonymously' : 'Anonymous'}
        </ThemedText>
      ) : (
        <Pressable onPress={() => router.push(`/user/${post.author_username}`)}>
          <ThemedText type="smallBold">
            {post.author_display_name}{' '}
            <ThemedText type="small" themeColor="textSecondary">
              @{post.author_username}
            </ThemedText>
          </ThemedText>
        </Pressable>
      )}

      <ThemedText>{post.body}</ThemedText>

      {post.is_mine && post.is_anonymous ? (
        <ThemedText type="small" themeColor="textSecondary">
          Only you can see that this is yours.
        </ThemedText>
      ) : null}

      {post.is_mine ? (
        <Pressable onPress={onDelete} style={styles.delete} accessibilityRole="button">
          <ThemedText type="small" style={{ color: theme.danger }}>
            Delete
          </ThemedText>
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, alignItems: 'center' },
  delete: { alignSelf: 'flex-end', paddingVertical: Spacing.one },
});
