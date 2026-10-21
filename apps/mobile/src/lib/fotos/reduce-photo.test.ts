const mockSizes = new Map<string, number>();

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));
jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    size: number;
    copy = jest.fn();
    delete = jest.fn();
    constructor(uri: string) {
      this.uri = uri;
      this.size = mockSizes.get(uri) ?? 0;
    }
  },
  Directory: class {
    create = jest.fn();
    constructor(..._args: unknown[]) {}
  },
  Paths: { document: 'file:///documents' },
}));

import * as ImageManipulator from 'expo-image-manipulator';
import { reduceIncidentPhoto, PHOTO_MAX_BYTES } from './reduce-photo';

describe('reduceIncidentPhoto', () => {
  it('resizes a 50 MB photo to 2560 px and recompresses it below 3 MB', async () => {
    mockSizes.clear();
    mockSizes.set('file:///source.jpg', 50_000_000);
    mockSizes.set('file:///first.jpg', PHOTO_MAX_BYTES + 1);
    mockSizes.set('file:///second.jpg', PHOTO_MAX_BYTES - 1);
    jest
      .mocked(ImageManipulator.manipulateAsync)
      .mockResolvedValueOnce({ uri: 'file:///first.jpg', width: 2560, height: 1440 })
      .mockResolvedValueOnce({ uri: 'file:///second.jpg', width: 2560, height: 1440 });

    const result = await reduceIncidentPhoto('file:///source.jpg', 'photo-1', 4000, 2250);

    expect(result).toMatchObject({ width: 2560, height: 1440, bytes: PHOTO_MAX_BYTES - 1 });
    expect(ImageManipulator.manipulateAsync).toHaveBeenNthCalledWith(
      1,
      'file:///source.jpg',
      [{ resize: { width: 2560, height: 1440 } }],
      { compress: 0.8, format: 'jpeg' },
    );
    expect(ImageManipulator.manipulateAsync).toHaveBeenNthCalledWith(2, 'file:///first.jpg', [], {
      compress: 0.6,
      format: 'jpeg',
    });
  });
});
