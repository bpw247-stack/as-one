import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { PostCard } from '@/components/post-card';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, ErrorText, Field, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useLoad } from '@/hooks/use-load';
import { useTheme } from '@/hooks/use-theme';
import { confirm, notify } from '@/lib/confirm';
import {
  addComment,
  deleteComment,
  getPost,
  MAX_COMMENT_LENGTH,
  postComments,
  postReactions,
  REACTION_LABELS,
  setCommentsPrivate,
  type Comment,
  type FeedPost,
  type ReactionEntry,
} from '@/lib/posts';
import { timeAgo } from '@/lib/time';

export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, loaded, reload } = useLoad(async () => {
    const post = await getPost(id);
    if (!post) return null;
    const [comments, reactions] = await Promise.all([
      post.is_anonymous ? Promise.resolve([]) : postComments(id),
      post.is_mine ? postReactions(id) : Promise.resolve([]),
    ]);
    return { post, comments, reactions };
  });

  if (!loaded) return <Screen />;
  if (!data) {
    return (
      <Screen>
        <ErrorText message={error} />
        <EmptyState title="Post not found" body="It may have been deleted." />
      </Screen>
    );
  }

  const { post, comments, reactions } = data;

  return (
    <Screen>
      <ErrorText message={error} />
      <PostCard post={post} onPostPage onDeleted={() => router.back()} />
      {post.is_mine ? <ReactionSummary reactions={reactions} /> : null}
      {post.is_anonymous ? (
        <ThemedText type="small" themeColor="textSecondary">
          Anonymous posts can only receive reactions.
        </ThemedText>
      ) : (
        <Comments post={post} comments={comments} onChange={reload} />
      )}
    </Screen>
  );
}

/** For the poster only. Names appear only where the reactor chose to share them. */
function ReactionSummary({ reactions }: { reactions: ReactionEntry[] }) {
  if (!reactions.length) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No reactions yet. Only you will ever see who reacted and how many.
      </ThemedText>
    );
  }

  const counts = new Map<string, number>();
  for (const r of reactions) counts.set(r.reaction, (counts.get(r.reaction) ?? 0) + 1);

  return (
    <Card>
      <ThemedText type="smallBold">Support you&apos;ve received</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Only you can see this.
      </ThemedText>
      {[...counts].map(([reaction, count]) => (
        <ThemedText key={reaction}>
          {REACTION_LABELS[reaction] ?? reaction} · {count}
        </ThemedText>
      ))}
      <View style={styles.reactorList}>
        {reactions.map((r, i) => (
          <ThemedText key={i} type="small" themeColor="textSecondary">
            {r.display_name ? `${r.display_name} (@${r.username})` : 'Someone'} —{' '}
            {REACTION_LABELS[r.reaction] ?? r.reaction}
          </ThemedText>
        ))}
      </View>
    </Card>
  );
}

function Comments({
  post,
  comments,
  onChange,
}: {
  post: FeedPost;
  comments: Comment[];
  onChange: () => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(post.comments_private);
  const theme = useTheme();

  const topLevel = comments.filter((c) => !c.reply_to);
  const repliesTo = (id: string) => comments.filter((c) => c.reply_to === id);
  const canWrite = post.can_comment || (post.is_mine && replyTo !== null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await addComment(post.id, draft.trim(), replyTo?.id);
      setDraft('');
      setReplyTo(null);
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Comment) {
    const ok = await confirm('Delete this comment?', '', 'Delete');
    if (!ok) return;
    try {
      await deleteComment(c.id);
      await onChange();
    } catch (e) {
      notify('Could not delete the comment', e instanceof Error ? e.message : undefined);
    }
  }

  async function togglePrivate(next: boolean) {
    setIsPrivate(next);
    try {
      await setCommentsPrivate(post.id, next);
    } catch (e) {
      setIsPrivate(!next);
      notify('Could not change that', e instanceof Error ? e.message : undefined);
    }
  }

  const visibilityNote = isPrivate
    ? `Only ${post.is_mine ? 'you' : post.author_display_name} will see ${post.is_mine ? 'comments' : 'your comment'}.`
    : 'Anyone who can see this post can read comments.';

  return (
    <View style={styles.comments}>
      <ThemedText type="smallBold">Comments</ThemedText>

      {post.is_mine ? (
        <View style={styles.switchRow}>
          <ThemedText type="small" style={styles.flex}>
            Only I see comments
          </ThemedText>
          <Switch value={isPrivate} onValueChange={togglePrivate} />
        </View>
      ) : null}

      {!topLevel.length ? (
        <ThemedText type="small" themeColor="textSecondary">
          {post.can_comment
            ? 'No comments yet.'
            : post.is_mine
              ? 'No comments yet. People in your Corner can comment here.'
              : 'Only people in their Corner can comment. You can still send a reaction.'}
        </ThemedText>
      ) : null}

      {topLevel.map((c) => (
        <Card key={c.id}>
          <CommentRow comment={c} canDelete={c.is_mine || post.is_mine} onDelete={() => remove(c)} />
          {repliesTo(c.id).map((r) => (
            <View key={r.id} style={[styles.reply, { borderLeftColor: theme.border }]}>
              <CommentRow comment={r} canDelete={r.is_mine || post.is_mine} onDelete={() => remove(r)} />
            </View>
          ))}
          {post.is_mine && !c.is_mine ? (
            <Pressable onPress={() => setReplyTo(c)} accessibilityRole="button">
              <ThemedText type="small" themeColor="textSecondary">
                Reply
              </ThemedText>
            </Pressable>
          ) : null}
        </Card>
      ))}

      {canWrite ? (
        <View style={styles.composer}>
          {replyTo ? (
            <View style={styles.switchRow}>
              <ThemedText type="small" style={styles.flex}>
                Replying to {replyTo.author_display_name}
              </ThemedText>
              <Pressable onPress={() => setReplyTo(null)}>
                <ThemedText type="small" themeColor="textSecondary">
                  Cancel
                </ThemedText>
              </Pressable>
            </View>
          ) : null}
          <Field
            label={replyTo ? 'Your reply' : 'Your comment'}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={MAX_COMMENT_LENGTH}
            hint={visibilityNote}
          />
          <ErrorText message={error} />
          <Button label="Send" onPress={send} busy={busy} disabled={!draft.trim()} />
        </View>
      ) : null}
    </View>
  );
}

function CommentRow({
  comment,
  canDelete,
  onDelete,
}: {
  comment: Comment;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.commentRow}>
      <ThemedText type="smallBold">
        {comment.author_display_name}
        {comment.is_poster ? ' · poster' : ''}{' '}
        <ThemedText type="small" themeColor="textSecondary">
          {timeAgo(comment.created_at)}
          {comment.is_private ? ' · private' : ''}
        </ThemedText>
      </ThemedText>
      <ThemedText>{comment.body}</ThemedText>
      {canDelete ? (
        <Pressable onPress={onDelete} accessibilityRole="button" style={styles.deleteComment}>
          <ThemedText type="small" style={{ color: theme.danger }}>
            Delete
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  comments: { gap: Spacing.three },
  composer: { gap: Spacing.two },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  flex: { flex: 1 },
  reply: { marginLeft: Spacing.three, paddingLeft: Spacing.three, borderLeftWidth: 2 },
  reactorList: { gap: Spacing.one, marginTop: Spacing.two },
  commentRow: { gap: Spacing.one },
  deleteComment: { alignSelf: 'flex-end' },
});
