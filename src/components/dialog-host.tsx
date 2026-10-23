import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { registerDialogHost, type DialogRequest } from '@/lib/confirm';

/** Renders confirm() and notify() dialogs inside the app on the web. */
export function DialogHost() {
  const [request, setRequest] = useState<DialogRequest | null>(null);

  useEffect(() => {
    registerDialogHost(setRequest);
    return () => registerDialogHost(null);
  }, []);

  function close(confirmed: boolean) {
    request?.resolve(confirmed);
    setRequest(null);
  }

  return (
    <Modal visible={request !== null} transparent animationType="fade" onRequestClose={() => close(false)}>
      <Pressable style={styles.backdrop} onPress={() => close(false)} accessibilityLabel="Close">
        <Pressable onPress={() => {}} accessibilityRole="alert">
          <ThemedView style={styles.dialog}>
            <ThemedText type="smallBold" style={styles.title}>
              {request?.title}
            </ThemedText>
            {request?.message ? <ThemedText type="small">{request.message}</ThemedText> : null}
            <View style={styles.actions}>
              {request?.confirmLabel ? (
                <>
                  <Button label="Cancel" variant="secondary" onPress={() => close(false)} />
                  <Button label={request.confirmLabel} variant="danger" onPress={() => close(true)} />
                </>
              ) : (
                <Button label="OK" onPress={() => close(true)} />
              )}
            </View>
          </ThemedView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#0008',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  dialog: { gap: Spacing.three, padding: Spacing.four, borderRadius: Spacing.three, maxWidth: 420 },
  title: { fontSize: 17 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two },
});
