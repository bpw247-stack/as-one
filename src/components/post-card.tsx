import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Card } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { confirm, notify } from "@/lib/confirm";
import {
  deletePost,
  KIND_LABELS,
  react,
  REACTIONS,
  unreact,
  type FeedPost,
} from "@/lib/posts";
import { useShowNameOnReact } from "@/lib/preferences";
import { anonymousTimeAgo, isPending, timeAgo } from "@/lib/time";

function audienceLabel(post: FeedPost) {
  if (post.is_anonymous) return "Anonymous";
  if (post.to_corner && post.to_everyone) return "Corner + Everyone";
  return post.to_corner ? "Corner" : "Everyone";
}

/**
 * One post. In a feed, tapping it opens the post page; on the post page itself
 * pass `onPostPage` so it doesn't link to itself.
 */
export function PostCard({
  post,
  onDeleted,
  onPostPage = false,
}: {
  post: FeedPost;
  onDeleted?: (id: string) => void;
  onPostPage?: boolean;
}) {
  const theme = useTheme();
  const pending = post.is_mine && isPending(post.published_at);
  const when =
    post.is_anonymous && !post.is_mine
      ? anonymousTimeAgo(post.published_at)
      : timeAgo(post.published_at);

  async function onDelete() {
    const ok = await confirm(
      "Delete this post?",
      "It will be removed for everyone.",
      "Delete",
    );
    if (!ok) return;
    try {
      await deletePost(post.id);
      onDeleted?.(post.id);
    } catch (e) {
      notify(
        "Could not delete the post",
        e instanceof Error ? e.message : undefined,
      );
    }
  }

  const open = onPostPage ? undefined : () => router.push(`/post/${post.id}`);

  return (
    <Card>
      <Pressable onPress={open} disabled={!open} style={styles.body}>
        <View style={styles.meta}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            {KIND_LABELS[post.kind]}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            · {pending ? "Posting in a few minutes" : when}
            {post.is_mine ? ` · ${audienceLabel(post)}` : ""}
          </ThemedText>
        </View>

        {post.is_anonymous ? (
          <ThemedText type="smallBold">
            {post.is_mine ? "You, anonymously" : "Anonymous"}
          </ThemedText>
        ) : (
          <Pressable
            onPress={() => router.push(`/user/${post.author_username}`)}
          >
            <ThemedText type="smallBold">
              {post.author_display_name}{" "}
              <ThemedText type="small" themeColor="textSecondary">
                @{post.author_username}
              </ThemedText>
            </ThemedText>
          </Pressable>
        )}

        {post.follow_up_excerpt ? (
          <ThemedText type="small" themeColor="textSecondary">
            Follow-up to “{post.follow_up_excerpt}”
          </ThemedText>
        ) : null}

        <ThemedText>{post.body}</ThemedText>

        {post.is_mine && post.is_anonymous ? (
          <ThemedText type="small" themeColor="textSecondary">
            Only you can see that this is yours.
          </ThemedText>
        ) : null}
      </Pressable>

      {post.is_mine ? (
        <OwnPostFooter post={post} onDelete={onDelete} />
      ) : (
        <ReactionBar post={post} />
      )}

      {!post.is_mine && (post.comment_count > 0 || post.can_comment) && open ? (
        <Pressable onPress={open} accessibilityRole="button">
          <ThemedText type="small" themeColor="textSecondary">
            {post.comment_count > 0
              ? `${post.comment_count} ${post.comment_count === 1 ? "comment" : "comments"}`
              : "Write a comment"}
          </ThemedText>
        </Pressable>
      ) : null}
    </Card>
  );
}

/** Preset reactions. Strangers and Corner alike can send them; nobody sees counts but the poster. */
function ReactionBar({ post }: { post: FeedPost }) {
  const theme = useTheme();
  const [showName] = useShowNameOnReact();
  const [mine, setMine] = useState(new Set(post.my_reactions));

  async function toggle(key: string) {
    const had = mine.has(key);
    const next = new Set(mine);
    if (had) next.delete(key);
    else next.add(key);
    setMine(next);
    try {
      if (had) await unreact(post.id, key);
      else await react(post.id, key, showName);
    } catch (e) {
      setMine(mine);
      notify("Could not send that", e instanceof Error ? e.message : undefined);
    }
  }

  return (
    <View style={styles.reactions}>
      {REACTIONS[post.kind].map((r) => {
        const active = mine.has(r.key);
        return (
          <Pressable
            key={r.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => toggle(r.key)}
            style={[
              styles.reaction,
              {
                backgroundColor: active ? theme.accent : theme.background,
                borderColor: active ? theme.accent : theme.border,
              },
            ]}
          >
            <ThemedText
              type="small"
              style={{ color: active ? theme.onAccent : theme.text }}
            >
              {r.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

function OwnPostFooter({
  post,
  onDelete,
}: {
  post: FeedPost;
  onDelete: () => void;
}) {
  const theme = useTheme();
  const reactions = post.reaction_count ?? 0;
  return (
    <View style={styles.ownFooter}>
      <Pressable onPress={() => router.push(`/post/${post.id}`)}>
        <ThemedText type="small" themeColor="textSecondary">
          {reactions} {reactions === 1 ? "reaction" : "reactions"}
          {post.is_anonymous
            ? ""
            : ` · ${post.comment_count} ${post.comment_count === 1 ? "comment" : "comments"}`}
          {" · only you see this"}
        </ThemedText>
      </Pressable>
      <View style={styles.ownActions}>
        {post.kind === "goal" ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push({
                pathname: "/compose",
                params: {
                  followUpOf: post.id,
                  followUpExcerpt: post.body.slice(0, 120),
                },
              })
            }
          >
            <ThemedText type="small" style={{ color: theme.accent }}>
              Post a follow-up
            </ThemedText>
          </Pressable>
        ) : null}
        <Pressable onPress={onDelete} accessibilityRole="button">
          <ThemedText type="small" style={{ color: theme.danger }}>
            Delete
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.two },
  meta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.one,
    alignItems: "center",
  },
  reactions: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  reaction: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.four,
    borderWidth: 1,
  },
  ownFooter: { gap: Spacing.two },
  ownActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.four,
  },
});
