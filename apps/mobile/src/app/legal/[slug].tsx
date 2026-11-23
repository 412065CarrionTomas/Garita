import { useLocalSearchParams } from 'expo-router';
import { LegalDocumentScreen } from '@/features/legal/legal-screens';

export default function LegalDocumentRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <LegalDocumentScreen slug={slug} />;
}
