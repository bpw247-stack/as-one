import { Feed } from '@/components/feed';
import { EmptyState } from '@/components/ui';
import { myPosts } from '@/lib/posts';

// Everything you've shared, including anonymous posts. Only you see this list.
export default function MyPostsScreen() {
  return (
    <Feed
      loadPage={(page, loaded) => myPosts(page === 0 ? undefined : loaded.at(-1)?.published_at)}
      empty={<EmptyState title="No posts yet" body="Everything you share, including anonymous posts, shows up here." />}
    />
  );
}
