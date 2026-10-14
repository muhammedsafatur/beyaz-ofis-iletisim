import { SafeAreaView, StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "@beyaz-ofis/ui-tokens";

// Başlangıç ekranı; navigasyon ve oturum akışı sonraki adımlarda eklenecek.
export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.center}>
        <Text style={styles.title}>Beyaz Ofis</Text>
        <Text style={styles.subtitle}>İskelet hazır</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  title: { fontSize: 24, fontWeight: "600", color: colors.text },
  subtitle: { fontSize: 14, color: colors.textMuted },
});
