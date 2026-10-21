import * as ImageManipulator from 'expo-image-manipulator';
import { File, Directory, Paths } from 'expo-file-system';

export const PHOTO_MAX_BYTES = 3 * 1024 * 1024;
const MAX_EDGE = 2560;

export async function reduceIncidentPhoto(
  uri: string,
  id: string,
  sourceWidth: number,
  sourceHeight: number,
): Promise<{ uri: string; width: number; height: number; bytes: number }> {
  const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  if (sourceWidth < 1 || sourceHeight < 1) throw new Error('No se pudo leer el tamaño de la foto');
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);
  let result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width, height } }], {
    compress: 0.8,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  let file = new File(result.uri);
  for (const quality of [0.6, 0.4]) {
    if ((file.size ?? 0) <= PHOTO_MAX_BYTES) break;
    result = await ImageManipulator.manipulateAsync(result.uri, [], {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    file = new File(result.uri);
  }
  if ((file.size ?? 0) > PHOTO_MAX_BYTES) throw new Error('La foto supera 3 MB tras reducirla');
  const directory = new Directory(Paths.document, 'incident-photos');
  directory.create({ idempotent: true, intermediates: true });
  const stored = new File(directory, `${id}.jpg`);
  await file.copy(stored);
  file.delete();
  return { uri: stored.uri, width: result.width, height: result.height, bytes: file.size ?? 0 };
}
