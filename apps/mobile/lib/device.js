import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
export const device = Platform.OS === 'android' ? requireOptionalNativeModule('NorthDevice') : null;
let adoptedNativeToken = null;
export async function deviceSession(client, owner) {
  if (!device) return;
  const saved = JSON.parse(await device.session());
  if (saved.owner === owner && saved.access_token && saved.access_token !== adoptedNativeToken) {
    const result = await client.auth.setSession({ access_token: saved.access_token, refresh_token: saved.refresh_token });
    if (result.error || result.data.user?.id !== owner) throw new Error('Sign in again to reconnect device sync.');
    adoptedNativeToken = saved.access_token;
  }
}
