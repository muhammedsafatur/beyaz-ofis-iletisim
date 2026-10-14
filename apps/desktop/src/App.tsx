import { colors, spacing } from "@beyaz-ofis/ui-tokens";

// Başlangıç ekranı; gerçek arayüz sonraki adımlarda eklenecek.
export default function App() {
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: spacing.lg,
        background: colors.background,
        color: colors.text,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1>Beyaz Ofis</h1>
      <p style={{ color: colors.textMuted }}>İskelet hazır</p>
    </main>
  );
}
