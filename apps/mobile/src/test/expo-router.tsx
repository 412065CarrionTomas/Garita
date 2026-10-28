import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { Text } from 'react-native';

const RouterContext = createContext({ replace: (_path: string) => undefined });
export const router = { replace: jest.fn() };
export function Link({ children }: { children: ReactNode }) {
  return <Text accessibilityRole="link">{children}</Text>;
}
export function Redirect() {
  return null;
}
export function Stack({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
export function useRouter() {
  return useContext(RouterContext);
}
