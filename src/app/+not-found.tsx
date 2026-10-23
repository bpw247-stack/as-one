import { Redirect } from 'expo-router';

// Any address the app doesn't know (an old link, or the demo page's own URL)
// goes to the start of the app.
export default function NotFound() {
  return <Redirect href="/" />;
}
