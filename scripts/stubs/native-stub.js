/**
 * Stub for native-only modules during the syntax check.
 *
 * `scripts/check-jsx.mjs` transforms files WITHOUT executing them, but Vite
 * still resolves their imports. The mobile client's dependencies (react-native,
 * expo-*) are not installed at the repo root — that is the whole reason mobile
 * has no build step here — so they are aliased to this module. Nothing is ever
 * run, so the contents only need to exist; the point is to parse the phone's
 * JSX with the same transform the real app would use.
 */
export default {};
export const View = () => null;
export const Text = () => null;
export const TextInput = () => null;
export const TouchableOpacity = () => null;
export const ScrollView = () => null;
export const SafeAreaView = () => null;
export const StyleSheet = { create: (o) => o, hairlineWidth: 1, absoluteFill: {} };
export const useColorScheme = () => "light";
export const StatusBar = () => null;
