import '@/features/panico/bloqueado/register';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from '@/features/auth/auth-context';
import { NotificationNavigation } from '@/features/notificaciones/notification-navigation';
import { ThemeProvider, useAppFonts, useStackOptions, useTheme } from '@/ui';

void SplashScreen.preventAutoHideAsync();

function ThemedStack() {
  const { scheme } = useTheme();
  const options = useStackOptions();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={options} />
    </>
  );
}

export default function RootLayout() {
  const fontsReady = useAppFonts();
  useEffect(() => {
    if (fontsReady) void SplashScreen.hideAsync();
  }, [fontsReady]);
  if (!fontsReady) return null;
  return (
    <ThemeProvider>
      <AuthProvider>
        <NotificationNavigation />
        <ThemedStack />
      </AuthProvider>
    </ThemeProvider>
  );
}
