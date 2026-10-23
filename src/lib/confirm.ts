import { Alert, Platform } from 'react-native';

// On phones these use the system alert. On the web they use the app's own
// dialog (DialogHost): browser pop-ups are ugly, and some embedded pages
// block them entirely.

export type DialogRequest = {
  title: string;
  message?: string;
  /** Present for a yes/no question; absent for a notice. */
  confirmLabel?: string;
  resolve: (confirmed: boolean) => void;
};

let show: ((request: DialogRequest) => void) | null = null;

/** Called by DialogHost so web dialogs render in the app. */
export function registerDialogHost(handler: ((request: DialogRequest) => void) | null) {
  show = handler;
}

/** A yes/no prompt. */
export function confirm(title: string, message: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    if (show) return new Promise((resolve) => show!({ title, message, confirmLabel, resolve }));
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

export function notify(title: string, message?: string) {
  if (Platform.OS === 'web') {
    if (show) show({ title, message, resolve: () => {} });
    else window.alert(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
}
